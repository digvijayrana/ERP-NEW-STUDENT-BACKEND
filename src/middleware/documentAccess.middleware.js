const User = require('../models/User');
const ClassRoom = require('../models/ClassRoom');
const { getPermissionsForRole } = require('../services/permission.service');
const { resolveAccessToken, validateAccessToken } = require('../services/documentAccess.service');
const { ROLES, HTTP_STATUS } = require('../constants');
const { createAppError, rethrowMeaningful, respondWithError } = require('./errors');

function isDocumentFilePath(req) {
  try {
    const path = `${req.baseUrl || ''}${req.path || ''}`;
    return /\/documents\/[^/]+\/file\/?$/.test(path) || /\/documents\/[^/]+\/file\/?$/.test(req.path || '');
  } catch (error) {
    rethrowMeaningful('isDocumentFilePath', error, 'Failed to inspect document file path');
  }
}

/**
 * If ?accessToken= is present on a document file route, resolve it and attach req.user.
 * @returns {Promise<boolean>} true when auth was satisfied via the document token
 */
async function tryAttachDocumentAccessUser(req) {
  try {
    const raw = req.query?.accessToken;
    if (!raw || !isDocumentFilePath(req)) return false;

    const entry = resolveAccessToken(String(raw));
    if (!entry) return false;

    const user = await User.findById(entry.userId).select('-passwordHash');
    if (!user || !user.isActive) return false;

    req.user = user;
    req.permissions = await getPermissionsForRole(user.role);
    req.documentAccessEntry = entry;
    return true;
  } catch (error) {
    rethrowMeaningful(
      'tryAttachDocumentAccessUser',
      error,
      'Failed to authenticate with document access token'
    );
  }
}

/** When JWT auth already succeeded, optionally attach documentAccessEntry from ?accessToken=. */
function attachDocumentAccessEntry(req) {
  try {
    if (!req.query?.accessToken) return;
    const entry = resolveAccessToken(String(req.query.accessToken));
    if (entry) req.documentAccessEntry = entry;
  } catch (error) {
    rethrowMeaningful(
      'attachDocumentAccessEntry',
      error,
      'Failed to attach document access token to the request'
    );
  }
}

/** Allow matching signed document token, otherwise require students:view. */
function studentDocumentFileAccess(req, res, next) {
  try {
    const entry = req.documentAccessEntry;
    if (
      entry
      && entry.resourceType === 'student'
      && entry.resourceId === String(req.params.id)
      && entry.documentId === String(req.params.documentId)
    ) {
      return next();
    }
    const { requirePermission } = require('./auth');
    return requirePermission('students', 'view')(req, res, next);
  } catch (error) {
    return respondWithError(res, next, error, 'Unable to authorize student document access');
  }
}

/**
 * Teachers may read their own documents; others need teachers:view.
 * Signed document URLs (?accessToken=) skip role checks after token match.
 */
function teacherDocumentReadAccess(req, res, next) {
  try {
    const entry = req.documentAccessEntry;
    if (
      entry
      && entry.resourceType === 'teacher'
      && entry.resourceId === String(req.params.id)
      && (!req.params.docType || entry.documentId === String(req.params.docType))
    ) {
      return next();
    }
    if (req.user && req.user.role === ROLES.TEACHER) return next();
    const { requirePermission } = require('./auth');
    return requirePermission('teachers', 'view')(req, res, next);
  } catch (error) {
    return respondWithError(res, next, error, 'Unable to authorize teacher document access');
  }
}

/** Role/ownership checks for student document access. Throws with status FORBIDDEN when denied. */
async function ensureStudentDocumentAccess(req, student) {
  try {
    if (!req.user) {
      throw createAppError('Authentication required to access student documents', HTTP_STATUS.UNAUTHORIZED, 'UNAUTHORIZED');
    }
    if (!student) {
      throw createAppError('Student record is required for document access check', HTTP_STATUS.BAD_REQUEST, 'MISSING_STUDENT');
    }

    if (req.user.role === ROLES.STUDENT && req.user.student?.toString() !== req.params.id) {
      throw createAppError('Students can only access their own documents', HTTP_STATUS.FORBIDDEN, 'FORBIDDEN');
    }

    if (req.user.role === ROLES.PARENT) {
      const childIds = (req.user.linkedStudents?.length
        ? req.user.linkedStudents
        : (req.user.linkedStudent ? [req.user.linkedStudent] : [])).map(String);
      if (!childIds.includes(req.params.id)) {
        throw createAppError('Parents can only access their linked child documents', HTTP_STATUS.FORBIDDEN, 'FORBIDDEN');
      }
    }

    if (req.user.role === ROLES.TEACHER) {
      const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
      const canAccess = (student.enrollments || []).some((enrollment) =>
        classIds.some((id) => id.equals(enrollment.classRoom?._id || enrollment.classRoom))
      );
      if (!canAccess) {
        throw createAppError(
          'Teacher can only access assigned class student documents',
          HTTP_STATUS.FORBIDDEN,
          'FORBIDDEN'
        );
      }
    }
  } catch (error) {
    rethrowMeaningful(
      'ensureStudentDocumentAccess',
      error,
      'Student document access check failed'
    );
  }
}

function studentDocumentTokenMatches(req, studentId, documentId) {
  try {
    const entry = req.documentAccessEntry;
    if (
      entry
      && entry.resourceType === 'student'
      && entry.resourceId === String(studentId)
      && entry.documentId === String(documentId)
    ) {
      return true;
    }
    if (!req.query.accessToken || !req.user) return false;
    return validateAccessToken(String(req.query.accessToken), {
      userId: req.user._id || req.user.id,
      resourceType: 'student',
      resourceId: studentId,
      documentId
    });
  } catch (error) {
    rethrowMeaningful(
      'studentDocumentTokenMatches',
      error,
      'Failed to validate student document access token'
    );
  }
}

function teacherDocumentTokenMatches(req, teacherId, docType) {
  try {
    const entry = req.documentAccessEntry;
    if (
      entry
      && entry.resourceType === 'teacher'
      && entry.resourceId === String(teacherId)
      && entry.documentId === String(docType)
    ) {
      return true;
    }
    if (!req.query.accessToken || !req.user) return false;
    return validateAccessToken(String(req.query.accessToken), {
      userId: req.user._id || req.user.id,
      resourceType: 'teacher',
      resourceId: teacherId,
      documentId: docType
    });
  } catch (error) {
    rethrowMeaningful(
      'teacherDocumentTokenMatches',
      error,
      'Failed to validate teacher document access token'
    );
  }
}

/** Allow matching signed document token, otherwise require drivers:view. */
function vehicleDocumentFileAccess(req, res, next) {
  try {
    const entry = req.documentAccessEntry;
    if (
      entry
      && entry.resourceType === 'vehicle'
      && entry.resourceId === String(req.params.id)
      && entry.documentId === String(req.params.docType)
    ) {
      return next();
    }
    const { requirePermission } = require('./auth');
    return requirePermission('drivers', 'view')(req, res, next);
  } catch (error) {
    return respondWithError(res, next, error, 'Unable to authorize vehicle document access');
  }
}

function vehicleDocumentTokenMatches(req, vehicleId, docType) {
  try {
    const entry = req.documentAccessEntry;
    if (
      entry
      && entry.resourceType === 'vehicle'
      && entry.resourceId === String(vehicleId)
      && entry.documentId === String(docType)
    ) {
      return true;
    }
    if (!req.query.accessToken || !req.user) return false;
    return validateAccessToken(String(req.query.accessToken), {
      userId: req.user._id || req.user.id,
      resourceType: 'vehicle',
      resourceId: vehicleId,
      documentId: docType
    });
  } catch (error) {
    rethrowMeaningful(
      'vehicleDocumentTokenMatches',
      error,
      'Failed to validate vehicle document access token'
    );
  }
}

module.exports = {
  tryAttachDocumentAccessUser,
  attachDocumentAccessEntry,
  studentDocumentFileAccess,
  teacherDocumentReadAccess,
  vehicleDocumentFileAccess,
  ensureStudentDocumentAccess,
  studentDocumentTokenMatches,
  teacherDocumentTokenMatches,
  vehicleDocumentTokenMatches,
  isDocumentFilePath
};
