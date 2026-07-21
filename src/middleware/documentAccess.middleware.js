const User = require('../models/User');
const ClassRoom = require('../models/ClassRoom');
const { getPermissionsForRole } = require('../services/permission.service');
const { resolveAccessToken, validateAccessToken } = require('../services/documentAccess.service');
const { ROLES, HTTP_STATUS } = require('../constants');

function isDocumentFilePath(req) {
  const path = `${req.baseUrl || ''}${req.path || ''}`;
  return /\/documents\/[^/]+\/file\/?$/.test(path) || /\/documents\/[^/]+\/file\/?$/.test(req.path || '');
}

/**
 * If ?accessToken= is present on a document file route, resolve it and attach req.user.
 * @returns {Promise<boolean>} true when auth was satisfied via the document token
 */
async function tryAttachDocumentAccessUser(req) {
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
}

/** When JWT auth already succeeded, optionally attach documentAccessEntry from ?accessToken=. */
function attachDocumentAccessEntry(req) {
  if (!req.query?.accessToken) return;
  const entry = resolveAccessToken(String(req.query.accessToken));
  if (entry) req.documentAccessEntry = entry;
}

/** Allow matching signed document token, otherwise require students:view. */
function studentDocumentFileAccess(req, res, next) {
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
}

/**
 * Teachers may read their own documents; others need teachers:view.
 * Signed document URLs (?accessToken=) skip role checks after token match.
 */
function teacherDocumentReadAccess(req, res, next) {
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
}

/** Role/ownership checks for student document access. Throws with status FORBIDDEN when denied. */
async function ensureStudentDocumentAccess(req, student) {
  if (req.user.role === ROLES.STUDENT && req.user.student?.toString() !== req.params.id) {
    const error = new Error('Students can only access their own documents');
    error.status = HTTP_STATUS.FORBIDDEN;
    throw error;
  }
  if (req.user.role === ROLES.PARENT) {
    const childIds = (req.user.linkedStudents?.length
      ? req.user.linkedStudents
      : (req.user.linkedStudent ? [req.user.linkedStudent] : [])).map(String);
    if (!childIds.includes(req.params.id)) {
      const error = new Error('Parents can only access their linked child documents');
      error.status = HTTP_STATUS.FORBIDDEN;
      throw error;
    }
  }
  if (req.user.role === ROLES.TEACHER) {
    const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
    const canAccess = student.enrollments.some((enrollment) =>
      classIds.some((id) => id.equals(enrollment.classRoom?._id || enrollment.classRoom))
    );
    if (!canAccess) {
      const error = new Error('Teacher can only access assigned class student documents');
      error.status = HTTP_STATUS.FORBIDDEN;
      throw error;
    }
  }
}

function studentDocumentTokenMatches(req, studentId, documentId) {
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
}

function teacherDocumentTokenMatches(req, teacherId, docType) {
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
}

module.exports = {
  tryAttachDocumentAccessUser,
  attachDocumentAccessEntry,
  studentDocumentFileAccess,
  teacherDocumentReadAccess,
  ensureStudentDocumentAccess,
  studentDocumentTokenMatches,
  teacherDocumentTokenMatches,
  isDocumentFilePath
};
