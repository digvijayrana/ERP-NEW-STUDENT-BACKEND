const Vehicle = require('../models/Vehicle');
const BusRoute = require('../models/BusRoute');
const asyncHandler = require('../middleware/asyncHandler');
const { auditOnCreate, auditOnUpdate } = require('../utils/auditFields');
const { logEntityCreate, logEntityUpdate } = require('../services/activityLog.service');
const { uploadDocument, extractStorageKey, readDocument } = require('../services/documentStorage.service');
const { HTTP_STATUS, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');

const MODULE = 'drivers';
const SORT_FIELDS = ['vehicleNumber', 'model', 'driverName', 'status', 'createdAt'];
const DOC_TYPES = ['driverPhoto', 'driverAadhaar', 'driverLicensePhoto'];
const DOC_LABELS = {
  driverPhoto: 'Driver photo',
  driverAadhaar: 'Driver Aadhaar',
  driverLicensePhoto: 'Driver license photo'
};

function firstFile(files, field) {
  const entry = files && files[field];
  if (!entry) return null;
  return Array.isArray(entry) ? entry[0] : entry;
}

async function storeVehicleDocs(files) {
  const documents = {};
  for (const docType of DOC_TYPES) {
    const file = firstFile(files, docType);
    if (!file) continue;
    const stored = await uploadDocument(file, 'transport/drivers');
    documents[docType] = {
      url: stored.fileUrl,
      storageKey: stored.storageKey,
      originalName: file.originalname,
      uploadedAt: new Date()
    };
  }
  return documents;
}

const EDITABLE_FIELDS = [
  'vehicleNumber', 'model', 'type', 'capacity',
  'registrationExpiry', 'insuranceExpiry', 'pollutionExpiry', 'fitnessExpiry',
  'driverName', 'driverMobile', 'driverAddress', 'licenseNumber', 'licenseExpiry',
  'driverSalary', 'joiningDate', 'notes', 'status'
];

const PHONE_REGEX = /^\d{10}$/;

function pickPayload(body) {
  const payload = {};
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) payload[field] = body[field] === '' ? undefined : body[field];
  }
  if (payload.vehicleNumber) payload.vehicleNumber = String(payload.vehicleNumber).trim().toUpperCase();
  return payload;
}

function invalidMobile(payload) {
  if (payload.driverMobile && !PHONE_REGEX.test(String(payload.driverMobile).trim())) {
    return 'Driver mobile must be exactly 10 digits';
  }
  return null;
}

const EXPIRY_FIELDS = [
  'registrationExpiry',
  'insuranceExpiry',
  'pollutionExpiry',
  'fitnessExpiry',
  'licenseExpiry'
];

/** Expiry dates must be strictly in the future (not today or past). */
function invalidExpiryDates(payload) {
  const startOfTomorrow = new Date();
  startOfTomorrow.setHours(0, 0, 0, 0);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  for (const field of EXPIRY_FIELDS) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') continue;
    const value = new Date(payload[field]);
    if (Number.isNaN(value.getTime())) {
      return `${field} is not a valid date`;
    }
    if (value < startOfTomorrow) {
      return 'Expiry dates must be a future date (today or past dates are not allowed)';
    }
  }
  return null;
}

/**
 * Keep Bus Routes in sync when vehicle/driver details change so the Transport
 * "Bus routes" list reflects the latest driver name, mobile, and vehicle number.
 */
async function syncLinkedBusRoutes(vehicle) {
  if (!vehicle?._id) return;
  const updates = {
    driverName: vehicle.driverName || '',
    driverMobile: vehicle.driverMobile || '',
    vehicleNumber: vehicle.vehicleNumber || '',
    capacity: vehicle.capacity || 40
  };
  await BusRoute.updateMany(
    {
      $or: [
        { vehicle: vehicle._id },
        { vehicleNumber: vehicle.vehicleNumber }
      ]
    },
    { $set: updates }
  );
}

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const regex = new RegExp(String(req.query.search).trim(), 'i');
    filter.$or = [
      { vehicleNumber: regex },
      { model: regex },
      { driverName: regex },
      { driverMobile: regex },
      { licenseNumber: regex }
    ];
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, SORT_FIELDS, 'vehicleNumber');

  const [vehicles, totalItems] = await Promise.all([
    Vehicle.find(filter).sort(sort).skip(skip).limit(pageSize),
    Vehicle.countDocuments(filter)
  ]);
  return sendPaginated(res, vehicles, { page, pageSize, totalItems });
});

exports.get = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Vehicle not found' });
  return res.json(vehicle);
});

exports.create = asyncHandler(async (req, res) => {
  const payload = pickPayload(req.body);
  if (!payload.vehicleNumber) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Vehicle number is required' });
  }
  const mobileError = invalidMobile(payload);
  if (mobileError) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: mobileError });
  const expiryError = invalidExpiryDates(payload);
  if (expiryError) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: expiryError });

  const missing = DOC_TYPES.filter((docType) => !firstFile(req.files, docType));
  if (missing.length) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      message: `${missing.map((d) => DOC_LABELS[d]).join(', ')} ${missing.length > 1 ? 'are' : 'is'} required`
    });
  }

  const existing = await Vehicle.findOne({ vehicleNumber: payload.vehicleNumber });
  if (existing) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: `Vehicle ${payload.vehicleNumber} already exists` });
  }

  const documents = await storeVehicleDocs(req.files);
  const vehicle = await Vehicle.create({ ...payload, documents, ...auditOnCreate(req.user) });

  logEntityCreate({
    module: MODULE,
    entityId: vehicle._id,
    entityLabel: vehicle.vehicleNumber,
    action: 'vehicle_create',
    description: `Vehicle registered: ${vehicle.vehicleNumber}`,
    user: req.user
  });

  return res.status(HTTP_STATUS.CREATED).json(vehicle);
});

exports.update = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Vehicle not found' });

  const payload = pickPayload(req.body);
  const mobileError = invalidMobile(payload);
  if (mobileError) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: mobileError });
  const expiryError = invalidExpiryDates(payload);
  if (expiryError) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: expiryError });
  if (payload.vehicleNumber && payload.vehicleNumber !== vehicle.vehicleNumber) {
    const clash = await Vehicle.findOne({ vehicleNumber: payload.vehicleNumber, _id: { $ne: vehicle._id } });
    if (clash) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: `Vehicle ${payload.vehicleNumber} already exists` });
    }
  }

  const uploaded = await storeVehicleDocs(req.files);
  const existingDocs = vehicle.documents || {};
  const missing = DOC_TYPES.filter((docType) => !uploaded[docType] && !existingDocs[docType]?.url);
  if (missing.length) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      message: `${missing.map((d) => DOC_LABELS[d]).join(', ')} ${missing.length > 1 ? 'are' : 'is'} required`
    });
  }

  Object.assign(vehicle, payload, auditOnUpdate(req.user));
  if (Object.keys(uploaded).length) {
    vehicle.documents = { ...(vehicle.documents ? vehicle.documents.toObject?.() || vehicle.documents : {}), ...uploaded };
  }
  await vehicle.save();

  // Propagate driver/vehicle details to every linked bus route.
  await syncLinkedBusRoutes(vehicle);

  logEntityUpdate({
    module: MODULE,
    entityId: vehicle._id,
    entityLabel: vehicle.vehicleNumber,
    action: 'vehicle_update',
    description: `Vehicle updated: ${vehicle.vehicleNumber}`,
    user: req.user
  });

  return res.json(vehicle);
});

exports.toggleStatus = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Vehicle not found' });
  vehicle.status = vehicle.status === 'active' ? 'inactive' : 'active';
  Object.assign(vehicle, auditOnUpdate(req.user));
  await vehicle.save();

  logEntityUpdate({
    module: MODULE,
    entityId: vehicle._id,
    entityLabel: vehicle.vehicleNumber,
    action: 'vehicle_status_change',
    description: `Vehicle ${vehicle.status}: ${vehicle.vehicleNumber}`,
    user: req.user
  });

  return res.json(vehicle);
});

exports.remove = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Vehicle not found' });
  vehicle.status = 'inactive';
  vehicle.isDeleted = true;
  vehicle.deletedAt = new Date();
  if (req.user?._id) vehicle.deletedBy = req.user._id;
  Object.assign(vehicle, auditOnUpdate(req.user));
  await vehicle.save();

  logEntityUpdate({
    module: MODULE,
    entityId: vehicle._id,
    entityLabel: vehicle.vehicleNumber,
    action: 'vehicle_delete',
    description: `Vehicle removed: ${vehicle.vehicleNumber}`,
    user: req.user
  });

  return res.json({ deleted: true });
});

exports.streamDocument = asyncHandler(async (req, res) => {
  try {
    const { docType } = req.params;
    if (!DOC_TYPES.includes(docType)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        message: 'Unknown document type',
        code: 'INVALID_DOC_TYPE'
      });
    }

    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        message: 'Vehicle not found',
        code: 'NOT_FOUND'
      });
    }

    const doc = vehicle.documents?.[docType];
    if (!doc?.url) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        message: 'Document not found',
        code: 'NOT_FOUND'
      });
    }

    const key = extractStorageKey(doc.url, doc.storageKey);
    if (!key) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        message: 'Document storage key not found',
        code: 'MISSING_STORAGE_KEY'
      });
    }

    try {
      const provider = doc.url.startsWith('local://') ? 'local' : 's3';
      const { body, contentType } = await readDocument(key, provider);
      const fileName = (doc.originalName || docType).replace(/[^\w.\-() ]/g, '_');
      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
      if (body.pipe) {
        body.pipe(res);
      } else {
        res.end(body);
      }
    } catch (storageError) {
      const status = storageError.code === 'NotFound' ? HTTP_STATUS.NOT_FOUND : 502;
      return res.status(status).json({
        message: storageError.message || 'Unable to read vehicle document from storage',
        code: storageError.code || 'STORAGE_ERROR'
      });
    }
  } catch (error) {
    const status = error.status || error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
    return res.status(status).json({
      message: error.message || 'Failed to stream vehicle document',
      code: error.code || 'DOCUMENT_STREAM_ERROR'
    });
  }
});
