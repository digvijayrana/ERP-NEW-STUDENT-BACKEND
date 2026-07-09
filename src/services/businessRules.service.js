const { getEffectivePolicySection } = require('./governanceConfig.service');
const { hasPermission } = require('./permission.service');
const { recordActivity } = require('./activityLog.service');
const { ACTIONS, MODULES } = require('../constants/activityActions');
const { HTTP_STATUS, ROLES } = require('../constants');
const {
  PROTECTED_MASTER_FIELDS,
  REVERSAL_ACTIONS,
  AUDITABLE_OPERATIONS
} = require('../config/businessRules.config');

function ruleError(message, code = 'BUSINESS_RULE_VIOLATION', status = HTTP_STATUS.BAD_REQUEST) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function stripProtectedFields(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const clean = { ...payload };
  for (const field of PROTECTED_MASTER_FIELDS) {
    delete clean[field];
  }
  return clean;
}

async function getEffectivePolicy(section, asOf = new Date()) {
  return getEffectivePolicySection(section, asOf);
}

function assertReversalAllowed(reversalKey, user, permissions) {
  const rule = REVERSAL_ACTIONS[reversalKey];
  if (!rule) throw ruleError(`Unsupported reversal action: ${reversalKey}`);
  if (user?.role === ROLES.SUPER_ADMIN) return rule;
  if (!hasPermission(permissions, rule.module, rule.permission)) {
    throw ruleError(
      `You do not have permission to perform ${rule.label}`,
      'REVERSAL_FORBIDDEN',
      HTTP_STATUS.FORBIDDEN
    );
  }
  return rule;
}

function assertRecordNotLocked(record, message = 'Record is locked and cannot be modified') {
  if (record?.locked || record?.workflowStatus === 'locked') {
    throw ruleError(message, 'LOCKED_RECORD', HTTP_STATUS.BAD_REQUEST);
  }
}

function logUnlock({
  module,
  entityId,
  entityLabel,
  user,
  req,
  previousValue,
  updatedValue,
  remarks
}) {
  recordActivity({
    module,
    entityId,
    entityLabel,
    action: ACTIONS.RECORD_UNLOCK,
    description: `Record unlocked: ${entityLabel || entityId || module}`,
    user,
    req,
    previousValue,
    updatedValue,
    remarks,
    meta: { operation: 'unlock' }
  });
}

function logReversal({
  module,
  entityId,
  entityLabel,
  reversalType,
  user,
  req,
  previousValue,
  updatedValue,
  remarks,
  meta
}) {
  recordActivity({
    module,
    entityId,
    entityLabel,
    action: ACTIONS.STATUS_CHANGE,
    description: `Authorized reversal (${reversalType}): ${entityLabel || entityId || module}`,
    user,
    req,
    previousValue,
    updatedValue,
    remarks,
    meta: { operation: 'reversal', reversalType, ...meta }
  });
}

function logReportAccess(req, domain, reportType, format, filters = {}) {
  recordActivity({
    module: MODULES.REPORTS,
    entityLabel: `${domain}/${reportType}`,
    action: ACTIONS.CREATE,
    description: `Report accessed (${format}): ${domain}/${reportType}`,
    user: req.user,
    req,
    meta: { domain, reportType, format, filters, readOnly: true }
  });
}

function getFrameworkCatalog() {
  return {
    framework: 'common-business-rules',
    version: 1,
    auditableOperations: AUDITABLE_OPERATIONS,
    reversalActions: REVERSAL_ACTIONS,
    protectedMasterFields: PROTECTED_MASTER_FIELDS,
    principles: [
      'Every transaction is auditable',
      'Historical records are preserved',
      'Reversals require authorized workflows',
      'Locked records require privileged unlock',
      'Master records maintain created/updated metadata',
      'Policies use effective dating',
      'Reports are read-only'
    ]
  };
}

module.exports = {
  ruleError,
  stripProtectedFields,
  getEffectivePolicy,
  assertReversalAllowed,
  assertRecordNotLocked,
  logUnlock,
  logReversal,
  logReportAccess,
  getFrameworkCatalog,
  PROTECTED_MASTER_FIELDS
};
