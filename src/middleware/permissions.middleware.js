const { requirePermission, authorize, authenticate, requireSuperAdmin, requireUnlock, requireApprove } = require('./auth');

function perms(module) {
  return {
    view: requirePermission(module, 'view'),
    create: requirePermission(module, 'create'),
    edit: requirePermission(module, 'edit'),
    deactivate: requirePermission(module, 'deactivate'),
    approve: requirePermission(module, 'approve'),
    unlock: requirePermission(module, 'unlock'),
    export: requirePermission(module, 'export'),
    print: requirePermission(module, 'print'),
    delete: requirePermission(module, 'delete')
  };
}

/** Named permission middleware for every ERP module used in routes. */
const permissions = {
  students: perms('students'),
  teachers: perms('teachers'),
  fees: perms('fees'),
  fee_prediction: perms('fee_prediction'),
  payroll: perms('payroll'),
  attendance: perms('attendance'),
  transport: perms('transport'),
  drivers: perms('drivers'),
  timetable: perms('timetable'),
  timetable_generator: perms('timetable_generator'),
  exams: perms('exams'),
  reports: perms('reports'),
  governance: perms('governance'),
  dashboard: perms('dashboard'),
  users: perms('users'),
  roleAdmin: perms('roles'),
  academic_year: perms('academic_year'),
  classes: perms('classes'),
  holidays: perms('holidays')
};

/** Multi-role authorize shortcuts used across routes. */
const roles = {
  teacher: authorize('teacher'),
  admin: authorize('admin'),
  student: authorize('student'),
  schoolUsers: authorize('admin', 'teacher', 'student', 'parent'),
  staff: authorize('admin', 'teacher')
};

module.exports = {
  authenticate,
  authorize,
  requirePermission,
  requireSuperAdmin,
  requireUnlock,
  requireApprove,
  permissions,
  roles,
  ...permissions
};
