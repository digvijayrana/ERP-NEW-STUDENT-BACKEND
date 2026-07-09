const Teacher = require('../models/Teacher');
const asyncHandler = require('../middleware/asyncHandler');
const { uploadDocument, extractStorageKey, readDocument } = require('../services/documentStorage.service');
const { createLogger } = require('../utils/logger');
const {
  ACTIONS,
  auditOnCreate,
  auditOnUpdate,
  logEntityCreate,
  logEntityUpdate,
  logStatusChange
} = require('../services/activityLog.service');
const { validateTeacherUniques, ensureTeacherCanDeactivate } = require('../services/integrity.service');
const { applySalaryRevision } = require('../services/payroll.service');
const { MODULES } = require('../constants/activityActions');
const { HTTP_STATUS, ROLES, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');
const { maskTeacherRecord } = require('../utils/dataMasking');
const { logDocumentAccess } = require('../services/activityLog.service');
const { issueAccessToken, validateAccessToken, getAccessTtlSeconds } = require('../services/documentAccess.service');

const TEACHER_SORT_FIELDS = ['firstName', 'employeeCode', 'phone', 'baseSalary', 'status', 'createdAt'];
const log = createLogger('teachers');

exports.create = asyncHandler(async (req, res) => {
  await validateTeacherUniques(req.body);

  const teacher = await Teacher.create({
    ...req.body,
    ...auditOnCreate(req.user),
    salaryHistory: req.body.baseSalary != null
      ? [{ basicSalary: Number(req.body.baseSalary), effectiveFrom: req.body.joiningDate || new Date() }]
      : []
  });

  logEntityCreate({
    module: MODULES.TEACHERS,
    entityId: teacher._id,
    entityLabel: teacher.employeeCode,
    action: ACTIONS.REGISTRATION,
    description: `Teacher registered: ${teacher.firstName} ${teacher.lastName || ''}`.trim(),
    user: req.user,
    meta: { employeeCode: teacher.employeeCode }
  });

  res.status(HTTP_STATUS.CREATED).json(teacher);
});

exports.list = asyncHandler(async (req, res) => {
  const filter = req.user.role === ROLES.TEACHER ? { _id: req.user.teacher } : {};
  if (req.query.status) filter.status = req.query.status;
  else if (req.user.role !== ROLES.TEACHER) filter.status = 'active';
  if (req.query.search) {
    const term = req.query.search.trim();
    const regex = new RegExp(term, 'i');
    filter.$or = [
      { employeeCode: regex },
      { firstName: regex },
      { lastName: regex },
      { phone: term },
      { email: regex }
    ];
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, TEACHER_SORT_FIELDS, 'firstName');

  const [teachers, totalItems] = await Promise.all([
    Teacher.find(filter).sort(sort).skip(skip).limit(pageSize),
    Teacher.countDocuments(filter)
  ]);

  return sendPaginated(
    res,
    teachers.map((teacher) => maskTeacherRecord(teacher, req.user, req.permissions)),
    { page, pageSize, totalItems }
  );
});

exports.get = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.TEACHER && req.user.teacher?.toString() !== req.params.id) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Teachers can only access their own staff profile' });
  }
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });
  res.json(maskTeacherRecord(teacher, req.user, req.permissions));
});

exports.update = asyncHandler(async (req, res) => {
  const existing = await Teacher.findById(req.params.id);
  if (!existing) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });

  const uniqueFields = {};
  for (const key of ['employeeCode', 'phone', 'email', 'aadhaarNumber']) {
    if (req.body[key] !== undefined) uniqueFields[key] = req.body[key];
  }
  if (Object.keys(uniqueFields).length) {
    await validateTeacherUniques(uniqueFields, existing._id);
  }

  const deactivating =
    req.body.status === 'inactive' && existing.status !== 'inactive';
  if (deactivating) {
    await ensureTeacherCanDeactivate(existing._id, {
      module: MODULES.TEACHERS,
      entityId: existing._id,
      entityLabel: existing.employeeCode,
      user: req.user
    });
  }

  const salaryChanging =
    req.body.baseSalary !== undefined && Number(req.body.baseSalary) !== Number(existing.baseSalary);
  if (salaryChanging) {
    await applySalaryRevision(
      existing,
      req.body.baseSalary,
      req.body.salaryEffectiveFrom,
      req.user
    );
    delete req.body.baseSalary;
    delete req.body.salaryEffectiveFrom;
  }

  const teacher = await Teacher.findByIdAndUpdate(
    req.params.id,
    { ...req.body, ...auditOnUpdate(req.user) },
    { new: true, runValidators: true }
  );

  logEntityUpdate({
    module: MODULES.TEACHERS,
    entityId: teacher._id,
    entityLabel: teacher.employeeCode,
    action: ACTIONS.UPDATE,
    description: `Teacher profile updated: ${teacher.employeeCode}`,
    user: req.user
  });

  if (req.body.status !== undefined && req.body.status !== existing.status) {
    logStatusChange({
      module: MODULES.TEACHERS,
      entityId: teacher._id,
      entityLabel: teacher.employeeCode,
      previousStatus: existing.status,
      newStatus: teacher.status,
      user: req.user
    });
  }

  res.json(maskTeacherRecord(teacher, req.user, req.permissions));
});

exports.remove = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });

  await ensureTeacherCanDeactivate(teacher._id, {
    module: MODULES.TEACHERS,
    entityId: teacher._id,
    entityLabel: teacher.employeeCode,
    user: req.user
  });

  teacher.status = 'inactive';
  Object.assign(teacher, auditOnUpdate(req.user));
  await teacher.save();

  logEntityUpdate({
    module: MODULES.TEACHERS,
    entityId: teacher._id,
    entityLabel: teacher.employeeCode,
    action: ACTIONS.DEACTIVATE,
    description: `Teacher deactivated: ${teacher.employeeCode}`,
    user: req.user
  });

  res.json({ deactivated: true, teacher });
});

exports.uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Document file is required' });
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });

  const docType = req.body.type || 'idProof';
  const stored = await uploadDocument(req.file, 'teachers/documents');
  const docEntry = {
    url: stored.fileUrl,
    storageKey: stored.storageKey,
    originalName: req.file.originalname,
    uploadedAt: new Date(),
    status: 'pending',
    rejectReason: ''
  };

  if (docType === 'idProof') {
    teacher.documents = teacher.documents || {};
    teacher.documents.idProof = docEntry;
  } else if (docType === 'resume') {
    teacher.documents = teacher.documents || {};
    teacher.documents.resume = docEntry;
  } else {
    teacher.documents = teacher.documents || {};
    teacher.documents.certificates = teacher.documents.certificates || [];
    teacher.documents.certificates.push(docEntry);
  }

  await teacher.save();
  res.status(HTTP_STATUS.CREATED).json(teacher.documents);
});

exports.selfUpdate = asyncHandler(async (req, res) => {
  const teacherId = req.user.teacher;
  if (!teacherId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'No teacher linked to this account' });

  const allowed = ['experience', 'education', 'qualification', 'email', 'phone'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const uniqueFields = {};
  if (updates.phone !== undefined) uniqueFields.phone = updates.phone;
  if (updates.email !== undefined) uniqueFields.email = updates.email;
  if (Object.keys(uniqueFields).length) {
    await validateTeacherUniques(uniqueFields, teacherId);
  }

  const teacher = await Teacher.findByIdAndUpdate(teacherId, updates, { new: true, runValidators: true });
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });
  res.json(maskTeacherRecord(teacher, req.user, req.permissions));
});

exports.selfUploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Document file is required' });
  const teacherId = req.user.teacher;
  if (!teacherId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'No teacher linked to this account' });

  const teacher = await Teacher.findById(teacherId);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });

  const docType = req.body.type || 'idProof';
  const stored = await uploadDocument(req.file, 'teachers/documents');
  const docEntry = {
    url: stored.fileUrl,
    storageKey: stored.storageKey,
    originalName: req.file.originalname,
    uploadedAt: new Date(),
    status: 'pending',
    rejectReason: ''
  };

  teacher.documents = teacher.documents || {};
  if (docType === 'idProof') {
    teacher.documents.idProof = docEntry;
  } else if (docType === 'resume') {
    teacher.documents.resume = docEntry;
  } else {
    teacher.documents.certificates = teacher.documents.certificates || [];
    teacher.documents.certificates.push(docEntry);
  }

  await teacher.save();
  res.status(HTTP_STATUS.CREATED).json(teacher.documents);
});

exports.verifyDocument = asyncHandler(async (req, res) => {
  const { docType, action, reason } = req.body;
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });

  teacher.documents = teacher.documents || {};
  const status = action === 'approve' ? 'approved' : 'rejected';
  const rejectReason = action === 'reject' ? (reason || 'Please reupload with correct document') : '';

  if (docType === 'idProof' && teacher.documents.idProof) {
    teacher.documents.idProof.status = status;
    teacher.documents.idProof.rejectReason = rejectReason;
  } else if (docType === 'resume' && teacher.documents.resume) {
    teacher.documents.resume.status = status;
    teacher.documents.resume.rejectReason = rejectReason;
  }

  await teacher.save();
  res.json({ message: `Document ${status}`, documents: teacher.documents });
});

exports.getDocumentUrl = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });

  if (req.user.role === ROLES.TEACHER && req.user.teacher?.toString() !== req.params.id) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Teachers can only access their own documents' });
  }

  const docType = req.params.docType;
  const doc = teacher.documents?.[docType];
  if (!doc?.url) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Document not found' });

  const accessToken = issueAccessToken({
    userId: req.user._id || req.user.id,
    resourceType: 'teacher',
    resourceId: teacher._id,
    documentId: docType
  });
  const url = `${req.protocol}://${req.get('host')}/api/teachers/${req.params.id}/documents/${docType}/file?accessToken=${accessToken}`;
  res.json({ url, expiresInSeconds: getAccessTtlSeconds() });
});

exports.streamDocument = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });

  const docType = req.params.docType;
  const accessToken = req.query.accessToken;
  const tokenValid = accessToken && validateAccessToken(accessToken, {
    userId: req.user._id || req.user.id,
    resourceType: 'teacher',
    resourceId: teacher._id,
    documentId: docType
  });

  if (!tokenValid) {
    if (req.user.role === ROLES.TEACHER && req.user.teacher?.toString() !== req.params.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Teachers can only access their own documents' });
    }
  }

  const doc = teacher.documents?.[docType];
  if (!doc?.url) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Document not found' });

  logDocumentAccess({
    module: MODULES.TEACHERS,
    entityId: teacher._id,
    entityLabel: teacher.employeeCode,
    documentType: docType,
    user: req.user,
    req
  });

  const key = extractStorageKey(doc.url, doc.storageKey);
  if (!key) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Document storage key not found' });
  }

  try {
    const { body, contentType } = await readDocument(key, 's3');
    const fileName = (doc.originalName || docType).replace(/[^\w.\-() ]/g, '_');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
    if (body.pipe) {
      body.pipe(res);
      return;
    }
    if (Buffer.isBuffer(body)) {
      return res.send(body);
    }
    const buffer = Buffer.from(await body.transformToByteArray());
    return res.send(buffer);
  } catch (error) {
    log.error('Teacher document stream failed', { teacherId: req.params.id, docType, key, error: error.message });
    const status = error.code === 'NotFound' ? HTTP_STATUS.NOT_FOUND : 502;
    return res.status(status).json({ message: error.message });
  }
});
