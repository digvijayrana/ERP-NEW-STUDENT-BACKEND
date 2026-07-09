const AcademicYear = require('../models/AcademicYear');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Timetable = require('../models/Timetable');
const Payroll = require('../models/Payroll');
const Attendance = require('../models/Attendance');
const TeacherAttendance = require('../models/TeacherAttendance');
const User = require('../models/User');
const Exam = require('../models/Exam');
const { HTTP_STATUS } = require('../constants');
const { recordActivity } = require('./activityLog.service');
const { ACTIONS } = require('../constants/activityActions');

const INTEGRITY_CODE = 'INTEGRITY_VIOLATION';
const DEPENDENCY_CODE = 'DEPENDENCY_BLOCK';

function integrityError(message, code = INTEGRITY_CODE, details) {
  const error = new Error(message);
  error.status = HTTP_STATUS.BAD_REQUEST;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function logIntegrityFailure({ module, entityId, entityLabel, rule, message, user, details }) {
  recordActivity({
    module,
    entityId,
    entityLabel,
    action: ACTIONS.INTEGRITY_VIOLATION,
    description: `Integrity rule violated (${rule}): ${message}`,
    user,
    meta: { rule, details }
  });
}

function throwWithAudit(message, code, details, audit) {
  if (audit) {
    logIntegrityFailure({
      module: audit.module,
      entityId: audit.entityId,
      entityLabel: audit.entityLabel,
      rule: code,
      message,
      user: audit.user,
      details
    });
  }
  throw integrityError(message, code, details);
}

async function countStudentsInClass(classId, academicYearId) {
  return Student.countDocuments({
    status: 'active',
    enrollments: {
      $elemMatch: {
        classRoom: classId,
        academicYear: academicYearId,
        status: 'studying'
      }
    }
  });
}

async function ensureAcademicYearEditable(academicYearId) {
  const year = await AcademicYear.findById(academicYearId);
  if (!year) {
    throw integrityError('Academic year not found', INTEGRITY_CODE);
  }
  const status = year.status || (year.isActive ? 'active' : 'draft');
  if (status === 'closed') {
    const archived = year.archivedAt ? 'archived and ' : '';
    throw integrityError(`Classes linked to an ${archived}closed academic year are read-only`, INTEGRITY_CODE);
  }
  return year;
}

async function ensureUniqueClassCombination(name, section, academicYear, classId) {
  const duplicate = await ClassRoom.findOne({
    name: String(name).trim(),
    section: String(section).trim(),
    academicYear,
    ...(classId ? { _id: { $ne: classId } } : {})
  }).select('name section');

  if (duplicate) {
    throw integrityError(`Class ${name}-${section} already exists for this academic year`, INTEGRITY_CODE);
  }
}

async function ensureClassCapacityNotBelowEnrollment(classId, academicYearId, newCapacity) {
  const capacity = Number(newCapacity);
  if (Number.isNaN(capacity) || capacity < 0) {
    throw integrityError('Capacity must be a non-negative number', INTEGRITY_CODE);
  }
  const enrolled = await countStudentsInClass(classId, academicYearId);
  if (capacity < enrolled) {
    throw integrityError(
      `Maximum capacity cannot be reduced below current student count (${enrolled})`,
      INTEGRITY_CODE,
      { studentCount: enrolled, requestedCapacity: capacity }
    );
  }
}

async function ensureClassHasNoEnrolledStudents(classId) {
  const enrolled = await Student.countDocuments({
    enrollments: { $elemMatch: { classRoom: classId, status: 'studying' } }
  });
  if (enrolled > 0) {
    throw integrityError(
      'Class cannot be deleted because it has enrolled students',
      INTEGRITY_CODE,
      { studentCount: enrolled }
    );
  }
}

async function findDuplicateTeacher(field, value, excludeId) {
  if (value === undefined || value === null || value === '') return null;
  const query = { [field]: value, ...(excludeId ? { _id: { $ne: excludeId } } : {}) };
  return Teacher.findOne(query).select('employeeCode firstName lastName');
}

async function validateTeacherUniques(data, excludeId) {
  const checks = [
    { field: 'employeeCode', label: 'Employee code', value: data.employeeCode },
    { field: 'phone', label: 'Phone number', value: data.phone },
    {
      field: 'email',
      label: 'Email address',
      value: data.email ? String(data.email).toLowerCase().trim() : undefined
    },
    {
      field: 'aadhaarNumber',
      label: 'Aadhaar number',
      value: data.aadhaarNumber ? String(data.aadhaarNumber).replace(/\s/g, '') : undefined
    }
  ];

  for (const check of checks) {
    if (check.value === undefined) continue;
    const duplicate = await findDuplicateTeacher(check.field, check.value, excludeId);
    if (duplicate) {
      throw integrityError(`${check.label} already exists`, 'DUPLICATE_RECORD', {
        field: check.field,
        existingId: duplicate._id
      });
    }
  }
}

async function ensureTeacherCanDeactivate(teacherId, audit) {
  const id = teacherId?.toString?.() || teacherId;
  const [
    classTeacherRooms,
    subjectRooms,
    timetableSlots,
    payrollRecords,
    attendanceMarked,
    teacherAttendance,
    linkedUsers,
    examsCreated
  ] = await Promise.all([
    ClassRoom.find({ classTeacher: id, status: 'active' }).select('name section'),
    ClassRoom.find({ 'subjects.teacher': id, status: 'active' }).select('name section'),
    Timetable.countDocuments({ 'periods.teacher': id }),
    Payroll.countDocuments({ teacher: id }),
    Attendance.countDocuments({ markedBy: id }),
    TeacherAttendance.countDocuments({ teacher: id }),
    User.countDocuments({ teacher: id, isActive: { $ne: false } }),
    Exam.countDocuments({ createdBy: id })
  ]);

  const details = {};
  if (classTeacherRooms.length) {
    details.activeClassTeacher = classTeacherRooms.map((r) => `${r.name}-${r.section}`);
  }
  if (subjectRooms.length) {
    details.subjectAssignments = subjectRooms.map((r) => `${r.name}-${r.section}`);
  }
  if (timetableSlots) details.timetableSlots = timetableSlots;
  if (payrollRecords) details.payrollRecords = payrollRecords;
  if (attendanceMarked) details.attendanceRecords = attendanceMarked;
  if (teacherAttendance) details.teacherAttendanceRecords = teacherAttendance;
  if (linkedUsers) details.linkedUserAccounts = linkedUsers;
  if (examsCreated) details.examsCreated = examsCreated;

  if (Object.keys(details).length) {
    throwWithAudit(
      'Teacher cannot be deactivated while assigned to dependent records. Reassign or resolve dependencies first.',
      DEPENDENCY_CODE,
      details,
      audit
    );
  }
}

function assertLockedReceiptEditable(payment, audit) {
  if (payment?.locked && payment.status !== 'void') {
    if (audit) {
      logIntegrityFailure({
        module: audit.module || 'fees',
        entityId: audit.entityId,
        entityLabel: payment.receiptNumber,
        rule: 'LOCKED_RECEIPT',
        message: 'Locked fee receipts cannot be modified',
        user: audit.user,
        details: { receiptNumber: payment.receiptNumber }
      });
    }
    throw integrityError('Locked fee receipts cannot be modified', 'LOCKED_RECORD');
  }
}

function assertHistoricalRegistrationImmutable(registration, audit) {
  if (registration.historicalLocked || (registration.status === 'inactive' && registration.serviceEndDate)) {
    const end = registration.serviceEndDate ? new Date(registration.serviceEndDate) : null;
    const isPast = end && end < new Date();
    if (registration.historicalLocked || isPast) {
      if (audit) {
        logIntegrityFailure({
          module: audit.module || 'transport',
          entityId: registration._id,
          entityLabel: audit.entityLabel,
          rule: 'HISTORICAL_BUS_REGISTRATION',
          message: 'Historical bus assignments cannot be modified',
          user: audit.user
        });
      }
      throw integrityError('Historical bus assignments cannot be modified. Create a new assignment instead.', 'HISTORICAL_RECORD');
    }
  }
}

module.exports = {
  INTEGRITY_CODE,
  DEPENDENCY_CODE,
  integrityError,
  logIntegrityFailure,
  throwWithAudit,
  countStudentsInClass,
  ensureAcademicYearEditable,
  ensureUniqueClassCombination,
  ensureClassCapacityNotBelowEnrollment,
  ensureClassHasNoEnrolledStudents,
  validateTeacherUniques,
  ensureTeacherCanDeactivate,
  assertLockedReceiptEditable,
  assertHistoricalRegistrationImmutable
};
