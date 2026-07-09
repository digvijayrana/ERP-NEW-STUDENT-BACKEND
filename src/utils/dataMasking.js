const { ROLES } = require('../constants');
const { hasPermission } = require('../services/permission.service');

function maskAadhaar(value) {
  if (value === undefined || value === null || value === '') return value;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

function canViewSensitivePii(user, permissions, module) {
  if (!user) return false;
  if ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PRINCIPAL].includes(user.role)) return true;
  return hasPermission(permissions, module, 'edit');
}

function maskStudentRecord(student, user, permissions) {
  const doc = student?.toObject ? student.toObject() : { ...(student || {}) };
  if (!canViewSensitivePii(user, permissions, 'students') && doc.aadhaarNumber) {
    doc.aadhaarNumber = maskAadhaar(doc.aadhaarNumber);
    doc.aadhaarMasked = true;
  }
  return doc;
}

function maskTeacherRecord(teacher, user, permissions) {
  const doc = teacher?.toObject ? teacher.toObject() : { ...(teacher || {}) };
  if (!canViewSensitivePii(user, permissions, 'teachers') && doc.aadhaarNumber) {
    doc.aadhaarNumber = maskAadhaar(doc.aadhaarNumber);
    doc.aadhaarMasked = true;
  }
  return doc;
}

module.exports = {
  maskAadhaar,
  canViewSensitivePii,
  maskStudentRecord,
  maskTeacherRecord
};
