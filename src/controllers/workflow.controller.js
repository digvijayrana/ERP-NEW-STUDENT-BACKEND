const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS } = require('../constants');
const { recordActivity } = require('../services/activityLog.service');
const { MODULES, ACTIONS } = require('../constants/activityActions');
const { hasPermission } = require('../services/permission.service');
const {
  listNotifications,
  dismissNotification,
  resetDismissals
} = require('../services/workflowNotification.service');
const { globalSearch } = require('../services/globalSearch.service');
const { executeBulkOperation } = require('../services/bulkOperations.service');

const BULK_PERMISSIONS = {
  'status-update': { module: 'students', action: 'edit' },
  'student-assignment': { module: 'students', action: 'edit' },
  'bus-assignment': { module: 'transport', action: 'edit' },
  'teacher-allocation': { module: 'classes', action: 'edit' },
  export: { module: 'students', action: 'export' },
  notifications: { module: 'students', action: 'edit' }
};

function assertBulkPermission(req, operation) {
  const rule = BULK_PERMISSIONS[operation];
  if (!rule) {
    const error = new Error('Unsupported bulk operation');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
  if (req.user.role === 'super_admin') return;
  if (!hasPermission(req.permissions, rule.module, rule.action)) {
    const error = new Error('You do not have permission for this bulk operation');
    error.status = HTTP_STATUS.FORBIDDEN;
    throw error;
  }
}

exports.notifications = asyncHandler(async (req, res) => {
  const items = await listNotifications(req.user, req.permissions);
  res.json({ items, total: items.length });
});

exports.dismissNotification = asyncHandler(async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Notification key is required' });
  const result = await dismissNotification(req.user, key);
  recordActivity({
    module: MODULES.REPORTS,
    entityLabel: key,
    action: ACTIONS.UPDATE,
    description: `Workflow notification dismissed: ${key}`,
    user: req.user
  });
  res.json(result);
});

exports.resetNotifications = asyncHandler(async (req, res) => {
  const result = await resetDismissals(req.user);
  res.json(result);
});

exports.search = asyncHandler(async (req, res) => {
  const results = await globalSearch(req.query.q, req.user, req.permissions);
  res.json({ results, query: String(req.query.q || '').trim() });
});

exports.bulk = asyncHandler(async (req, res) => {
  const { operation, payload, confirmed } = req.body;
  if (!operation) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Bulk operation is required' });
  if (!confirmed) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      message: 'Bulk operation requires confirmation',
      code: 'CONFIRMATION_REQUIRED'
    });
  }

  assertBulkPermission(req, operation);
  const result = await executeBulkOperation(operation, payload || {}, req.user);

  recordActivity({
    module: MODULES.REPORTS,
    entityLabel: operation,
    action: ACTIONS.UPDATE,
    description: `Bulk operation executed: ${operation}`,
    user: req.user,
    meta: { operation, result }
  });

  res.json({ operation, result });
});

exports.defaults = asyncHandler(async (req, res) => {
  const AcademicYear = require('../models/AcademicYear');
  const activeYear = await AcademicYear.findOne({ status: 'active' }).lean();
  const now = new Date();
  res.json({
    activeAcademicYearId: activeYear?._id || null,
    activeAcademicYearName: activeYear?.name || null,
    currentMonth: now.getMonth() + 1,
    currentYear: now.getFullYear(),
    today: now.toISOString().slice(0, 10)
  });
});
