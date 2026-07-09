const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const { ROLES } = require('../constants');
const { HTTP_STATUS } = require('../constants');

const PORTAL_ROLES = new Set([ROLES.STUDENT, ROLES.PARENT]);
const STAFF_SCOPED_ROLES = new Set([ROLES.TEACHER]);

async function getTeacherClassIds(teacherId) {
  if (!teacherId) return [];
  return ClassRoom.find({ classTeacher: teacherId, status: 'active' }).distinct('_id');
}

function linkedChildIds(user) {
  if (user.linkedStudents?.length) return user.linkedStudents.map((id) => String(id));
  if (user.linkedStudent) return [String(user.linkedStudent)];
  return [];
}

async function buildStudentFilterForUser(user) {
  if (!user) return {};
  if (user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN) return {};
  if (user.role === ROLES.STUDENT && user.student) {
    return { _id: user.student };
  }
  if (user.role === ROLES.PARENT) {
    const childIds = linkedChildIds(user);
    return childIds.length ? { _id: { $in: childIds } } : { _id: null };
  }
  if (user.role === ROLES.TEACHER && user.teacher) {
    const classIds = await getTeacherClassIds(user.teacher);
    return classIds.length
      ? { 'enrollments.classRoom': { $in: classIds } }
      : { _id: null };
  }
  return {};
}

async function buildClassFilterForUser(user) {
  if (!user) return {};
  if ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PRINCIPAL].includes(user.role)) return {};
  if (user.role === ROLES.TEACHER && user.teacher) {
    const classIds = await getTeacherClassIds(user.teacher);
    return classIds.length ? { _id: { $in: classIds } } : { _id: null };
  }
  if (user.role === ROLES.TRANSPORT_MANAGER) {
    return { status: 'active' };
  }
  return {};
}

async function assertStudentAccess(user, studentId) {
  if (!user || !studentId) return;
  if ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PRINCIPAL, ROLES.RECEPTION, ROLES.RECEPTIONIST, ROLES.ACCOUNTANT].includes(user.role)) {
    return;
  }
  if (user.role === ROLES.STUDENT && String(user.student) === String(studentId)) return;
  if (user.role === ROLES.PARENT && linkedChildIds(user).includes(String(studentId))) return;

  if (user.role === ROLES.TEACHER && user.teacher) {
    const classIds = await getTeacherClassIds(user.teacher);
    const student = await Student.findById(studentId).select('enrollments').lean();
    if (!student) {
      const error = new Error('Student not found');
      error.status = HTTP_STATUS.NOT_FOUND;
      throw error;
    }
    const assigned = (student.enrollments || []).some((entry) =>
      classIds.some((classId) => String(entry.classRoom) === String(classId))
    );
    if (assigned) return;
  }

  const error = new Error('You do not have access to this student record');
  error.status = HTTP_STATUS.FORBIDDEN;
  throw error;
}

async function assertClassAccess(user, classRoomId) {
  if (!user || !classRoomId) return;
  if ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PRINCIPAL].includes(user.role)) return;

  if (user.role === ROLES.TEACHER && user.teacher) {
    const classIds = await getTeacherClassIds(user.teacher);
    if (classIds.some((id) => String(id) === String(classRoomId))) return;
  }

  const error = new Error('You do not have access to this class');
  error.status = HTTP_STATUS.FORBIDDEN;
  throw error;
}

function canUnlock(user, permissions, module) {
  if (!user) return false;
  if (user.role === ROLES.SUPER_ADMIN) return true;
  return !!permissions?.[module]?.unlock;
}

function canApprove(user, permissions, module) {
  if (!user) return false;
  if (user.role === ROLES.SUPER_ADMIN) return true;
  return !!permissions?.[module]?.approve;
}

module.exports = {
  PORTAL_ROLES,
  STAFF_SCOPED_ROLES,
  getTeacherClassIds,
  linkedChildIds,
  buildStudentFilterForUser,
  buildClassFilterForUser,
  assertStudentAccess,
  assertClassAccess,
  canUnlock,
  canApprove
};
