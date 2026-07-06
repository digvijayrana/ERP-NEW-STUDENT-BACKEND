const ClassRoom = require('../models/ClassRoom');
const Teacher = require('../models/Teacher');
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
const {
  countStudentsInClass,
  ensureAcademicYearEditable,
  ensureUniqueClassCombination,
  ensureClassCapacityNotBelowEnrollment,
  ensureClassHasNoEnrolledStudents
} = require('../services/integrity.service');
const { MODULES } = require('../constants/activityActions');
const { HTTP_STATUS, ROLES, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');

const CLASS_SORT_FIELDS = ['name', 'monthlyFee', 'status', 'createdAt'];

const log = createLogger('class-room');

function normalizeClassPayload(payload) {
  const next = { ...payload };
  if (next.classTeacher === '') delete next.classTeacher;
  if (Array.isArray(next.subjects)) {
    next.subjects = next.subjects.map((subject) => {
      const normalized = { ...subject };
      if (normalized.teacher === '') delete normalized.teacher;
      return normalized;
    });
  }
  return next;
}

async function ensureClassTeacherIsAvailable(classTeacher, classId) {
  if (!classTeacher) return;

  const existing = await ClassRoom.findOne({
    classTeacher,
    ...(classId ? { _id: { $ne: classId } } : {})
  }).select('name section');

  if (existing) {
    const error = new Error(`This teacher is already class teacher for ${existing.name}-${existing.section}`);
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
}

async function enrichClass(classRoom) {
  const obj = classRoom.toObject ? classRoom.toObject() : { ...classRoom };
  const academicYearId = obj.academicYear?._id || obj.academicYear;
  const studentCount = academicYearId ? await countStudentsInClass(obj._id, academicYearId) : 0;
  const capacity = obj.capacity || 0;
  return {
    ...obj,
    studentCount,
    availableCapacity: Math.max(capacity - studentCount, 0)
  };
}

exports.create = asyncHandler(async (req, res) => {
  const payload = normalizeClassPayload(req.body);
  await ensureAcademicYearEditable(payload.academicYear);
  await ensureUniqueClassCombination(payload.name, payload.section, payload.academicYear);
  await ensureClassTeacherIsAvailable(payload.classTeacher);

  const classRoom = await ClassRoom.create({ ...payload, ...auditOnCreate(req.user) });
  log.info('Class created', { id: classRoom._id, name: classRoom.name, section: classRoom.section, userId: req.user?.id });

  logEntityCreate({
    module: MODULES.CLASSES,
    entityId: classRoom._id,
    entityLabel: `${classRoom.name}-${classRoom.section}`,
    action: ACTIONS.CREATE,
    description: `Class created: ${classRoom.name}-${classRoom.section}`,
    user: req.user,
    meta: { academicYear: classRoom.academicYear }
  });

  if (classRoom.classTeacher) {
    logEntityUpdate({
      module: MODULES.CLASSES,
      entityId: classRoom._id,
      entityLabel: `${classRoom.name}-${classRoom.section}`,
      action: ACTIONS.CLASS_TEACHER_ASSIGNMENT,
      description: `Class teacher assigned to ${classRoom.name}-${classRoom.section}`,
      user: req.user,
      meta: { classTeacher: classRoom.classTeacher }
    });
  }

  res.status(HTTP_STATUS.CREATED).json(await enrichClass(classRoom));
});

exports.list = asyncHandler(async (req, res) => {
  const filter = req.user.role === ROLES.TEACHER ? { classTeacher: req.user.teacher } : {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.academicYear) filter.academicYear = req.query.academicYear;
  if (req.query.search) {
    const term = req.query.search.trim();
    const regex = new RegExp(term, 'i');
    const teacherIds = await Teacher.find({
      $or: [{ firstName: regex }, { lastName: regex }, { employeeCode: regex }]
    }).distinct('_id');
    filter.$or = [
      { name: regex },
      { section: regex },
      ...(teacherIds.length ? [{ classTeacher: { $in: teacherIds } }] : [])
    ];
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, CLASS_SORT_FIELDS, 'name');

  const [classes, totalItems] = await Promise.all([
    ClassRoom.find(filter)
      .populate('academicYear', 'name isActive status')
      .populate('classTeacher', 'firstName lastName employeeCode')
      .populate('subjects.teacher', 'firstName lastName employeeCode')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    ClassRoom.countDocuments(filter)
  ]);

  const enriched = await Promise.all(classes.map((room) => enrichClass(room)));
  return sendPaginated(res, enriched, { page, pageSize, totalItems });
});

exports.update = asyncHandler(async (req, res) => {
  const existing = await ClassRoom.findById(req.params.id);
  if (!existing) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Class not found' });

  await ensureAcademicYearEditable(existing.academicYear);

  const payload = normalizeClassPayload(req.body);
  const nextName = payload.name ?? existing.name;
  const nextSection = payload.section ?? existing.section;
  const nextYear = payload.academicYear ?? existing.academicYear;

  await ensureUniqueClassCombination(nextName, nextSection, nextYear, existing._id);
  await ensureClassTeacherIsAvailable(payload.classTeacher, existing._id);

  if (payload.capacity !== undefined) {
    const yearId = payload.academicYear ?? existing.academicYear;
    await ensureClassCapacityNotBelowEnrollment(existing._id, yearId, payload.capacity);
  }

  const previousTeacher = existing.classTeacher?.toString();
  const previousStatus = existing.status;

  Object.assign(existing, payload, auditOnUpdate(req.user));
  await existing.save();

  log.info('Class updated', { id: existing._id, name: existing.name, section: existing.section, userId: req.user?.id });

  logEntityUpdate({
    module: MODULES.CLASSES,
    entityId: existing._id,
    entityLabel: `${existing.name}-${existing.section}`,
    action: ACTIONS.UPDATE,
    description: `Class updated: ${existing.name}-${existing.section}`,
    user: req.user
  });

  const nextTeacher = existing.classTeacher?.toString();
  if (payload.classTeacher !== undefined && nextTeacher !== previousTeacher) {
    logEntityUpdate({
      module: MODULES.CLASSES,
      entityId: existing._id,
      entityLabel: `${existing.name}-${existing.section}`,
      action: ACTIONS.CLASS_TEACHER_ASSIGNMENT,
      description: `Class teacher assignment changed for ${existing.name}-${existing.section}`,
      user: req.user,
      meta: { previousTeacher, classTeacher: nextTeacher }
    });
  }

  if (payload.status !== undefined && payload.status !== previousStatus) {
    logStatusChange({
      module: MODULES.CLASSES,
      entityId: existing._id,
      entityLabel: `${existing.name}-${existing.section}`,
      previousStatus,
      newStatus: existing.status,
      user: req.user
    });
  }

  res.json(await enrichClass(existing));
});

exports.remove = asyncHandler(async (req, res) => {
  const classRoom = await ClassRoom.findById(req.params.id);
  if (!classRoom) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Class not found' });

  await ensureClassHasNoEnrolledStudents(classRoom._id);

  await classRoom.deleteOne();
  log.info('Class deleted', { id: classRoom._id, name: classRoom.name, section: classRoom.section, userId: req.user?.id });
  res.json({ deleted: true });
});

exports.toggleStatus = asyncHandler(async (req, res) => {
  const classRoom = await ClassRoom.findById(req.params.id);
  if (!classRoom) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Class not found' });

  await ensureAcademicYearEditable(classRoom.academicYear);

  const previousStatus = classRoom.status;
  classRoom.status = classRoom.status === 'active' ? 'inactive' : 'active';
  Object.assign(classRoom, auditOnUpdate(req.user));
  await classRoom.save();

  log.info('Class status changed', { id: classRoom._id, status: classRoom.status, userId: req.user?.id });

  logStatusChange({
    module: MODULES.CLASSES,
    entityId: classRoom._id,
    entityLabel: `${classRoom.name}-${classRoom.section}`,
    previousStatus,
    newStatus: classRoom.status,
    user: req.user
  });

  res.json(await enrichClass(classRoom));
});

exports.countStudentsInClass = countStudentsInClass;
exports.enrichClass = enrichClass;
