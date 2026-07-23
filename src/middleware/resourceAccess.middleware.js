const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const asyncHandler = require('./asyncHandler');
const { ROLES, HTTP_STATUS } = require('../constants');
const { createAppError, rethrowMeaningful, respondWithError } = require('./errors');

function getLinkedChildIds(user) {
  try {
    if (!user) return [];
    if (user.linkedStudents?.length) return user.linkedStudents.map(String);
    if (user.linkedStudent) return [String(user.linkedStudent)];
    return [];
  } catch (error) {
    rethrowMeaningful('getLinkedChildIds', error, 'Failed to resolve linked child student IDs');
  }
}

/**
 * Ownership / role gate for a student resource.
 */
async function ensureStudentAccess(req, studentOrId) {
  try {
    if (!req.user) {
      throw createAppError('Authentication required to access student records', HTTP_STATUS.UNAUTHORIZED, 'UNAUTHORIZED');
    }

    const studentId = typeof studentOrId === 'string' || studentOrId?._id
      ? String(studentOrId._id || studentOrId)
      : String(req.params.id);

    if (!studentId || studentId === 'undefined') {
      throw createAppError('Student id is required', HTTP_STATUS.BAD_REQUEST, 'MISSING_STUDENT_ID');
    }

    if (req.user.role === ROLES.STUDENT && req.user.student?.toString() !== studentId) {
      throw createAppError('Students can only access their own profile', HTTP_STATUS.FORBIDDEN, 'FORBIDDEN');
    }

    if (req.user.role === ROLES.PARENT) {
      if (!getLinkedChildIds(req.user).includes(studentId)) {
        throw createAppError('Parents can only access their linked child profile', HTTP_STATUS.FORBIDDEN, 'FORBIDDEN');
      }
    }

    if (req.user.role === ROLES.TEACHER) {
      let student = studentOrId;
      if (!student || typeof student === 'string' || !student.enrollments) {
        student = await Student.findById(studentId).lean();
      }
      if (!student) {
        throw createAppError('Student not found', HTTP_STATUS.NOT_FOUND, 'NOT_FOUND');
      }
      const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
      const canAccess = (student.enrollments || []).some((enrollment) =>
        classIds.some((id) => id.equals(enrollment.classRoom?._id || enrollment.classRoom))
      );
      if (!canAccess) {
        throw createAppError('Teacher can only access assigned class students', HTTP_STATUS.FORBIDDEN, 'FORBIDDEN');
      }
    }
  } catch (error) {
    rethrowMeaningful('ensureStudentAccess', error, 'Student access check failed');
  }
}

/** Same checks as ensureStudentAccess but returns { error, status } instead of throwing. */
async function assertStudentAccess(req, studentId) {
  try {
    await ensureStudentAccess(req, studentId);
    return null;
  } catch (error) {
    return {
      error: error.message || 'Student access denied',
      status: error.status || error.statusCode || HTTP_STATUS.FORBIDDEN,
      code: error.code || 'FORBIDDEN'
    };
  }
}

function ensureTeacherSelfAccess(req, teacherId = req.params.id) {
  try {
    if (!req.user) {
      throw createAppError('Authentication required to access teacher records', HTTP_STATUS.UNAUTHORIZED, 'UNAUTHORIZED');
    }
    if (req.user.role === ROLES.TEACHER && req.user.teacher?.toString() !== String(teacherId)) {
      throw createAppError('Teachers can only access their own staff profile', HTTP_STATUS.FORBIDDEN, 'FORBIDDEN');
    }
  } catch (error) {
    rethrowMeaningful('ensureTeacherSelfAccess', error, 'Teacher self-access check failed');
  }
}

function ensureTeacherOwnDocuments(req, teacherId = req.params.id) {
  try {
    if (!req.user) {
      throw createAppError('Authentication required to access teacher documents', HTTP_STATUS.UNAUTHORIZED, 'UNAUTHORIZED');
    }
    if (req.user.role === ROLES.TEACHER && req.user.teacher?.toString() !== String(teacherId)) {
      throw createAppError('Teachers can only access their own documents', HTTP_STATUS.FORBIDDEN, 'FORBIDDEN');
    }
  } catch (error) {
    rethrowMeaningful('ensureTeacherOwnDocuments', error, 'Teacher document access check failed');
  }
}

function ensureInvoiceAccess(req, invoice) {
  try {
    if (!req.user) {
      throw createAppError('Authentication required to access fee invoices', HTTP_STATUS.UNAUTHORIZED, 'UNAUTHORIZED');
    }
    if (!invoice) {
      throw createAppError('Invoice record is required for access check', HTTP_STATUS.BAD_REQUEST, 'MISSING_INVOICE');
    }

    const studentId = invoice.student?._id?.toString() || invoice.student?.toString();
    if (req.user.role === ROLES.STUDENT && studentId !== req.user.student?.toString()) {
      throw createAppError('Students can access only their own fee records', HTTP_STATUS.FORBIDDEN, 'FORBIDDEN');
    }
    if (req.user.role === ROLES.PARENT) {
      if (!getLinkedChildIds(req.user).includes(String(studentId))) {
        throw createAppError('Parents can access only their linked child fee records', HTTP_STATUS.FORBIDDEN, 'FORBIDDEN');
      }
    }
  } catch (error) {
    rethrowMeaningful('ensureInvoiceAccess', error, 'Invoice access check failed');
  }
}

/** Express middleware: teachers may only hit their own :id. */
const requireTeacherSelfAccess = (req, res, next) => {
  try {
    ensureTeacherSelfAccess(req);
    return next();
  } catch (error) {
    return respondWithError(res, next, error, 'Teacher access denied');
  }
};

/** Express middleware: student/parent/teacher ownership for :id. */
const requireStudentAccess = asyncHandler(async (req, res, next) => {
  try {
    await ensureStudentAccess(req, req.params.id);
    return next();
  } catch (error) {
    return respondWithError(res, next, error, 'Student access denied');
  }
});

module.exports = {
  getLinkedChildIds,
  ensureStudentAccess,
  assertStudentAccess,
  ensureTeacherSelfAccess,
  ensureTeacherOwnDocuments,
  ensureInvoiceAccess,
  requireTeacherSelfAccess,
  requireStudentAccess
};
