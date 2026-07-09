const { stripProtectedFields, PROTECTED_MASTER_FIELDS } = require('../services/businessRules.service');

function masterRecordGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  if (!req.body || typeof req.body !== 'object') return next();

  req.body = stripProtectedFields(req.body);
  if (Array.isArray(req.body.enrollments)) {
    req.body.enrollments = req.body.enrollments.map((entry) => stripProtectedFields(entry));
  }
  if (Array.isArray(req.body.guardians)) {
    req.body.guardians = req.body.guardians.map((entry) => stripProtectedFields(entry));
  }

  next();
}

module.exports = {
  masterRecordGuard,
  PROTECTED_MASTER_FIELDS
};
