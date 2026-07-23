/**
 * Central middleware exports for the ERP API.
 * Prefer importing from here in route files.
 */
const auth = require('./auth');
const permissions = require('./permissions.middleware');
const documentAccess = require('./documentAccess.middleware');
const resourceAccess = require('./resourceAccess.middleware');
const uploads = require('./uploads.middleware');
const { reportReadOnlyGuard } = require('./reportReadOnly');
const { masterRecordGuard } = require('./masterRecordGuard');
const asyncHandler = require('./asyncHandler');
const requestLogger = require('./requestLogger');
const errorHandler = require('./errorHandler');
const tenantContext = require('./tenantContext');

module.exports = {
  // Auth core
  authenticate: auth.authenticate,
  authorize: auth.authorize,
  requirePermission: auth.requirePermission,
  requireSuperAdmin: auth.requireSuperAdmin,
  requireUnlock: auth.requireUnlock,
  requireApprove: auth.requireApprove,

  // Named permissions + role shortcuts
  permissions: permissions.permissions,
  roles: permissions.roles,
  students: permissions.students,
  teachers: permissions.teachers,
  fees: permissions.fees,
  fee_prediction: permissions.fee_prediction,
  payroll: permissions.payroll,
  attendance: permissions.attendance,
  transport: permissions.transport,
  drivers: permissions.drivers,
  timetable: permissions.timetable,
  timetable_generator: permissions.timetable_generator,
  exams: permissions.exams,
  reports: permissions.reports,
  governance: permissions.governance,
  dashboard: permissions.dashboard,
  users: permissions.users,
  roleAdmin: permissions.roleAdmin,
  academic_year: permissions.academic_year,
  classes: permissions.classes,
  holidays: permissions.holidays,

  // Document access
  ...documentAccess,

  // Resource ownership
  ...resourceAccess,

  // Uploads
  ...uploads,

  // Cross-cutting
  reportReadOnlyGuard,
  masterRecordGuard,
  asyncHandler,
  requestLogger,
  errorHandler,
  tenantContext,
  createAppError: require('../utils/appError').createAppError,
  rethrowMeaningful: require('../utils/appError').rethrowMeaningful,
  respondWithError: require('../utils/appError').respondWithError
};
