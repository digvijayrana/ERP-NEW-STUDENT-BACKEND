const AcademicYear = require('../models/AcademicYear');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const FeeInvoice = require('../models/FeeInvoice');
const Attendance = require('../models/Attendance');
const Exam = require('../models/Exam');
const Timetable = require('../models/Timetable');
const Admission = require('../models/Admission');
const Holiday = require('../models/Holiday');
const asyncHandler = require('../middleware/asyncHandler');
const { createLogger } = require('../utils/logger');
const {
  ACTIONS,
  auditOnCreate,
  auditOnUpdate,
  logEntityCreate,
  logEntityUpdate,
  logStatusChange
} = require('../services/activityLog.service');
const { MODULES } = require('../constants/activityActions');
const { HTTP_STATUS, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');
const { archiveAcademicYearData } = require('../services/academicYearArchive.service');
const { softDeleteDocument } = require('../services/softDelete.service');

const YEAR_SORT_FIELDS = ['name', 'startDate', 'endDate', 'status', 'createdAt'];

const log = createLogger('academic-year');

function normalizeStatus(year) {
  const obj = year.toObject ? year.toObject() : { ...year };
  if (!obj.status) {
    obj.status = obj.isActive ? 'active' : 'draft';
  }
  obj.isActive = obj.status === 'active';
  return obj;
}

function validateDates(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const err = new Error('Valid start and end dates are required');
    err.status = HTTP_STATUS.BAD_REQUEST;
    throw err;
  }
  if (end <= start) {
    const err = new Error('End date must be after start date');
    err.status = HTTP_STATUS.BAD_REQUEST;
    throw err;
  }
}

async function countDependencies(yearId) {
  const [classes, students, invoices, attendance, exams, timetables, admissions, holidays] = await Promise.all([
    ClassRoom.countDocuments({ academicYear: yearId }),
    Student.countDocuments({ 'enrollments.academicYear': yearId }),
    FeeInvoice.countDocuments({ academicYear: yearId }),
    Attendance.countDocuments({ academicYear: yearId }),
    Exam.countDocuments({ academicYear: yearId }),
    Timetable.countDocuments({ academicYear: yearId }),
    Admission.countDocuments({ academicYear: yearId }),
    Holiday.countDocuments({ academicYear: yearId })
  ]);

  return {
    classes,
    students,
    invoices,
    attendance,
    exams,
    timetables,
    admissions,
    holidays,
    total: classes + students + invoices + attendance + exams + timetables + admissions + holidays
  };
}

exports.create = asyncHandler(async (req, res) => {
  const { name, startDate, endDate, isActive } = req.body;
  validateDates(startDate, endDate);

  const trimmedName = String(name || '').trim();
  if (await AcademicYear.findOne({ name: trimmedName })) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Academic year name already exists' });
  }

  const status = isActive ? 'active' : 'draft';
  if (status === 'active') {
    await AcademicYear.updateMany({ status: 'active' }, { status: 'draft', isActive: false });
  }

  const year = await AcademicYear.create({ name: trimmedName, startDate, endDate, status, ...auditOnCreate(req.user) });
  log.info('Academic year created', { id: year._id, name: year.name, status: year.status, userId: req.user?.id });

  logEntityCreate({
    module: MODULES.ACADEMIC_YEARS,
    entityId: year._id,
    entityLabel: year.name,
    action: ACTIONS.CREATE,
    description: `Academic year created: ${year.name}`,
    user: req.user,
    meta: { status: year.status }
  });

  if (status === 'active') {
    logStatusChange({
      module: MODULES.ACADEMIC_YEARS,
      entityId: year._id,
      entityLabel: year.name,
      previousStatus: 'draft',
      newStatus: 'active',
      user: req.user,
      remarks: 'Set as active on create'
    });
  }

  res.status(HTTP_STATUS.CREATED).json(normalizeStatus(year));
});

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    filter.name = new RegExp(req.query.search.trim(), 'i');
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, YEAR_SORT_FIELDS, 'startDate');

  const [years, totalItems] = await Promise.all([
    AcademicYear.find(filter).sort(sort).skip(skip).limit(pageSize),
    AcademicYear.countDocuments(filter)
  ]);

  return sendPaginated(res, years.map(normalizeStatus), { page, pageSize, totalItems });
});

exports.get = asyncHandler(async (req, res) => {
  const year = await AcademicYear.findById(req.params.id);
  if (!year) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Academic year not found' });
  res.json(normalizeStatus(year));
});

exports.update = asyncHandler(async (req, res) => {
  const year = await AcademicYear.findById(req.params.id);
  if (!year) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Academic year not found' });

  const current = normalizeStatus(year);
  if (current.status === 'closed') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Closed academic years cannot be edited' });
  }

  const { name, startDate, endDate } = req.body;
  if (startDate && endDate) validateDates(startDate, endDate);
  else if (startDate || endDate) {
    validateDates(startDate || year.startDate, endDate || year.endDate);
  }

  if (name !== undefined) {
    const trimmedName = String(name).trim();
    const duplicate = await AcademicYear.findOne({ name: trimmedName, _id: { $ne: year._id } });
    if (duplicate) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Academic year name already exists' });
    }
    year.name = trimmedName;
  }
  if (startDate !== undefined) year.startDate = startDate;
  if (endDate !== undefined) year.endDate = endDate;
  Object.assign(year, auditOnUpdate(req.user));

  await year.save();
  log.info('Academic year updated', { id: year._id, name: year.name, userId: req.user?.id });

  logEntityUpdate({
    module: MODULES.ACADEMIC_YEARS,
    entityId: year._id,
    entityLabel: year.name,
    action: ACTIONS.UPDATE,
    description: `Academic year updated: ${year.name}`,
    user: req.user
  });

  res.json(normalizeStatus(year));
});

exports.activate = asyncHandler(async (req, res) => {
  const year = await AcademicYear.findById(req.params.id);
  if (!year) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Academic year not found' });

  const current = normalizeStatus(year);
  if (current.status === 'closed') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Closed academic years cannot be reactivated' });
  }
  if (current.status === 'active') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'This academic year is already active' });
  }

  const previousStatus = current.status;
  await AcademicYear.updateMany({ _id: { $ne: year._id }, status: 'active' }, { status: 'draft', isActive: false });

  year.status = 'active';
  year.isActive = true;
  year.closedAt = undefined;
  Object.assign(year, auditOnUpdate(req.user));
  await year.save();

  log.info('Academic year activated', { id: year._id, name: year.name, userId: req.user?.id });

  logStatusChange({
    module: MODULES.ACADEMIC_YEARS,
    entityId: year._id,
    entityLabel: year.name,
    previousStatus,
    newStatus: 'active',
    user: req.user,
    remarks: 'Academic year activated'
  });

  logEntityUpdate({
    module: MODULES.ACADEMIC_YEARS,
    entityId: year._id,
    entityLabel: year.name,
    action: ACTIONS.ACTIVATE,
    description: `Academic year activated: ${year.name}`,
    user: req.user
  });

  res.json(normalizeStatus(year));
});

exports.close = asyncHandler(async (req, res) => {
  const year = await AcademicYear.findById(req.params.id);
  if (!year) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Academic year not found' });

  const current = normalizeStatus(year);
  if (current.status === 'closed') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Academic year is already closed' });
  }

  const previousStatus = current.status;
  year.status = 'closed';
  year.isActive = false;
  year.closedAt = new Date();
  Object.assign(year, auditOnUpdate(req.user));
  await year.save();

  const archiveSummary = await archiveAcademicYearData(year._id, req.user);

  log.info('Academic year closed', { id: year._id, name: year.name, userId: req.user?.id, archiveSummary });

  logStatusChange({
    module: MODULES.ACADEMIC_YEARS,
    entityId: year._id,
    entityLabel: year.name,
    previousStatus,
    newStatus: 'closed',
    user: req.user,
    remarks: 'Academic year closed'
  });

  logEntityUpdate({
    module: MODULES.ACADEMIC_YEARS,
    entityId: year._id,
    entityLabel: year.name,
    action: ACTIONS.CLOSE,
    description: `Academic year closed: ${year.name}`,
    user: req.user
  });

  res.json({ ...normalizeStatus(year), archiveSummary });
});

exports.remove = asyncHandler(async (req, res) => {
  const year = await AcademicYear.findById(req.params.id);
  if (!year) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Academic year not found' });

  const current = normalizeStatus(year);
  if (current.status === 'active') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Active academic year cannot be deleted. Close it first.' });
  }

  const deps = await countDependencies(year._id);
  if (deps.total > 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      message: 'Academic year has dependent records and cannot be deleted',
      dependencies: deps
    });
  }

  await softDeleteDocument(year, req.user);
  log.info('Academic year soft deleted', { id: year._id, name: year.name, userId: req.user?.id });
  res.json({ deleted: true, softDeleted: true });
});
