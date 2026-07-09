const mongoose = require('mongoose');
const Student = require('../models/Student');
const ClassRoom = require('../models/ClassRoom');
const BusRegistration = require('../models/BusRegistration');
const BusRoute = require('../models/BusRoute');
const Teacher = require('../models/Teacher');
const { ensureAcademicYearEditable } = require('./integrity.service');
const { validateInactiveClassAssignment } = require('./dataQuality.service');
const { recordActivity } = require('./activityLog.service');
const { MODULES, ACTIONS } = require('../constants/activityActions');
const { HTTP_STATUS } = require('../constants');
const { BULK_MAX_ITEMS } = require('../config/workflow.config');
const { enqueueJob } = require('./jobQueue.service');

function bulkError(message, details) {
  const error = new Error(message);
  error.status = HTTP_STATUS.BAD_REQUEST;
  error.details = details;
  return error;
}

function normalizeIds(ids) {
  const unique = [...new Set((ids || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!unique.length) throw bulkError('At least one record id is required');
  if (unique.length > BULK_MAX_ITEMS) {
    throw bulkError(`Bulk operations are limited to ${BULK_MAX_ITEMS} records`);
  }
  const invalid = unique.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalid.length) throw bulkError('One or more record ids are invalid', { invalid });
  return unique;
}

async function bulkStatusUpdate({ entity, ids, status }, user) {
  const recordIds = normalizeIds(ids);
  if (!status) throw bulkError('Status is required');

  if (entity === 'students') {
    const allowed = new Set(['active', 'inactive', 'left_school', 'passed_out', 'tc_issued']);
    if (!allowed.has(status)) throw bulkError('Invalid student status');

    const students = await Student.find({ _id: { $in: recordIds } });
    if (students.length !== recordIds.length) {
      throw bulkError('Some student records were not found');
    }

    const updates = [];
    for (const student of students) {
      const previousStatus = student.status;
      student.status = status;
      student.activityLog.push({
        action: 'status_change',
        description: `Bulk status update to ${status}`,
        performedBy: user?.email || user?.id,
        performedAt: new Date(),
        meta: { previousStatus, newStatus: status, bulk: true }
      });
      updates.push(student.save());
    }
    await Promise.all(updates);

    recordActivity({
      module: MODULES.STUDENTS,
      entityLabel: `${students.length} students`,
      action: ACTIONS.STATUS_CHANGE,
      description: `Bulk student status update to ${status}`,
      user,
      meta: { count: students.length, status, ids: recordIds }
    });

    return { updated: students.length, entity, status };
  }

  throw bulkError('Unsupported entity for bulk status update');
}

async function bulkStudentAssignment({ studentIds, classRoomId, academicYearId }, user) {
  const ids = normalizeIds(studentIds);
  if (!classRoomId || !academicYearId) throw bulkError('Class and academic year are required');

  await ensureAcademicYearEditable(academicYearId);
  const classRoom = await ClassRoom.findById(classRoomId);
  if (!classRoom) throw bulkError('Class not found');
  await validateInactiveClassAssignment(classRoomId);
  if (String(classRoom.academicYear) !== String(academicYearId)) {
    throw bulkError('Selected class does not belong to the academic year');
  }

  const students = await Student.find({ _id: { $in: ids }, status: 'active' });
  if (!students.length) throw bulkError('No active students found for assignment');

  let assigned = 0;
  for (const student of students) {
    const existing = (student.enrollments || []).find(
      (entry) => String(entry.academicYear) === String(academicYearId) && entry.status === 'studying'
    );
    if (existing) {
      existing.classRoom = classRoomId;
      existing.monthlyFee = classRoom.monthlyFee;
    } else {
      student.enrollments.push({
        academicYear: academicYearId,
        classRoom: classRoomId,
        monthlyFee: classRoom.monthlyFee,
        status: 'studying',
        fromDate: new Date()
      });
    }
    student.activityLog.push({
      action: 'profile_update',
      description: `Bulk class assignment to ${classRoom.name}-${classRoom.section}`,
      performedBy: user?.email || user?.id,
      performedAt: new Date(),
      meta: { classRoomId, academicYearId, bulk: true }
    });
    await student.save();
    assigned += 1;
  }

  recordActivity({
    module: MODULES.STUDENTS,
    entityLabel: `${assigned} students`,
    action: ACTIONS.UPDATE,
    description: `Bulk student class assignment`,
    user,
    meta: { assigned, classRoomId, academicYearId }
  });

  return { assigned, classRoomId, academicYearId };
}

async function bulkBusAssignment(payload, user) {
  const {
    studentIds,
    routeId,
    stopName,
    stopSequence,
    academicYearId,
    serviceStartDate,
    monthlyFee
  } = payload;
  const ids = normalizeIds(studentIds);
  if (!routeId || !academicYearId || !stopName || !stopSequence) {
    throw bulkError('Route, academic year, and stop details are required');
  }

  await ensureAcademicYearEditable(academicYearId);
  const route = await BusRoute.findById(routeId);
  if (!route || route.status !== 'active') throw bulkError('Active bus route not found');

  const stop = (route.stops || []).find((entry) => entry.sequence === Number(stopSequence));
  const fee = monthlyFee ?? stop?.monthlyFee ?? route.fixedMonthlyFee ?? 0;
  const startDate = serviceStartDate ? new Date(serviceStartDate) : new Date();

  let assigned = 0;
  for (const studentId of ids) {
    await BusRegistration.findOneAndUpdate(
      { student: studentId, academicYear: academicYearId, status: 'active' },
      {
        student: studentId,
        academicYear: academicYearId,
        route: routeId,
        stopName,
        stopSequence: Number(stopSequence),
        monthlyFee: fee,
        busService: true,
        serviceStartDate: startDate,
        status: 'active'
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    assigned += 1;
  }

  recordActivity({
    module: MODULES.TRANSPORT,
    entityLabel: `${assigned} students`,
    action: ACTIONS.UPDATE,
    description: 'Bulk bus route assignment',
    user,
    meta: { routeId, academicYearId, stopName, stopSequence, count: assigned }
  });

  return { assigned, routeId, academicYearId };
}

async function bulkTeacherAllocation({ classRoomIds, teacherId }, user) {
  const classIds = normalizeIds(classRoomIds);
  if (!teacherId) throw bulkError('Teacher is required');

  const teacher = await Teacher.findById(teacherId);
  if (!teacher || teacher.status !== 'active') throw bulkError('Active teacher not found');

  const classes = await ClassRoom.find({ _id: { $in: classIds }, status: 'active' });
  if (!classes.length) throw bulkError('No active classes found');

  for (const classRoom of classes) {
    await ensureAcademicYearEditable(classRoom.academicYear);
    classRoom.classTeacher = teacherId;
    await classRoom.save();
  }

  recordActivity({
    module: MODULES.CLASSES,
    entityLabel: `${classes.length} classes`,
    action: ACTIONS.CLASS_TEACHER_ASSIGNMENT,
    description: `Bulk class teacher allocation to ${teacher.employeeCode}`,
    user,
    meta: { teacherId, classRoomIds: classIds }
  });

  return { updated: classes.length, teacherId };
}

async function bulkExport({ entity, ids }, user) {
  const recordIds = normalizeIds(ids);
  if (entity === 'students') {
    const students = await Student.find({ _id: { $in: recordIds } })
      .populate('enrollments.classRoom', 'name section')
      .lean();
    return {
      entity,
      count: students.length,
      rows: students.map((student) => ({
        admissionNumber: student.admissionNumber,
        name: [student.firstName, student.lastName].filter(Boolean).join(' '),
        status: student.status,
        class: student.enrollments?.[0]?.classRoom
          ? `${student.enrollments[0].classRoom.name}-${student.enrollments[0].classRoom.section}`
          : ''
      }))
    };
  }

  throw bulkError('Unsupported entity for bulk export');
}

async function bulkNotifications({ studentIds, message, channel = 'in_app' }, user) {
  const ids = normalizeIds(studentIds);
  const text = String(message || '').trim();
  if (!text) throw bulkError('Notification message is required');

  const students = await Student.find({ _id: { $in: ids } }).select('admissionNumber firstName lastName');
  const job = await enqueueJob('bulk_notification', { studentIds: ids, message: text, channel }, user);

  recordActivity({
    module: MODULES.STUDENTS,
    entityLabel: `${students.length} students`,
    action: ACTIONS.UPDATE,
    description: 'Bulk notification queued',
    user,
    meta: { channel, message: text, studentIds: ids, jobId: job._id }
  });

  return {
    queued: students.length,
    channel,
    jobId: job._id,
    status: job.status,
    recipients: students.map((student) => ({
      id: String(student._id),
      admissionNumber: student.admissionNumber,
      name: [student.firstName, student.lastName].filter(Boolean).join(' ')
    }))
  };
}

async function executeBulkOperation(operation, payload, user) {
  switch (operation) {
    case 'status-update':
      return bulkStatusUpdate(payload, user);
    case 'student-assignment':
      return bulkStudentAssignment(payload, user);
    case 'bus-assignment':
      return bulkBusAssignment(payload, user);
    case 'teacher-allocation':
      return bulkTeacherAllocation(payload, user);
    case 'export':
      return bulkExport(payload, user);
    case 'notifications':
      return bulkNotifications(payload, user);
    default:
      throw bulkError('Unsupported bulk operation');
  }
}

module.exports = {
  executeBulkOperation
};
