const Activity = require('../models/Activity');
const { ACTIONS } = require('../constants/activityActions');
const { createLogger } = require('../utils/logger');
const { auditOnCreate, auditOnUpdate } = require('../utils/auditFields');
const { auditContextFromRequest } = require('../utils/auditRequest');

const log = createLogger('activity-log');

function performerFromUser(user) {
  if (!user) {
    return { email: 'system', name: 'System', role: 'system' };
  }
  return {
    userId: user._id || user.id,
    email: user.email,
    name: user.name,
    role: user.role
  };
}

function buildActivityEntry(action, description, user, meta = {}) {
  return {
    action,
    description,
    performedBy: user?.email || user?.id || 'system',
    performedAt: new Date(),
    meta
  };
}

function buildStatusChangeEntry(previousStatus, newStatus, user, remarks, extraMeta = {}) {
  const remarkText = remarks ? `: ${remarks}` : '';
  return buildActivityEntry(
    ACTIONS.STATUS_CHANGE,
    `Status changed from ${previousStatus} to ${newStatus}${remarkText}`,
    user,
    {
      previousStatus,
      newStatus,
      remarks: remarks || undefined,
      ...extraMeta
    }
  );
}

function recordActivity({
  module,
  entityId,
  entityLabel,
  action,
  description,
  user,
  meta,
  req,
  previousValue,
  updatedValue,
  remarks
}) {
  const audit = auditContextFromRequest(req);
  const payload = {
    module,
    entityId,
    entityLabel,
    action,
    description,
    performedBy: performerFromUser(user),
    performedAt: new Date(),
    ipAddress: audit.ipAddress,
    userAgent: audit.userAgent,
    previousValue,
    updatedValue,
    remarks,
    meta: {
      ...(meta || {}),
      requestId: audit.requestId
    }
  };

  setImmediate(() => {
    Activity.create(payload).catch((error) => {
      log.warn('Activity log write failed', { module, action, error: error.message });
    });
  });
}

function recordActivitySync(payload) {
  const audit = auditContextFromRequest(payload.req);
  return Activity.create({
    module: payload.module,
    entityId: payload.entityId,
    entityLabel: payload.entityLabel,
    action: payload.action,
    description: payload.description,
    performedBy: performerFromUser(payload.user),
    performedAt: new Date(),
    ipAddress: audit.ipAddress,
    userAgent: audit.userAgent,
    previousValue: payload.previousValue,
    updatedValue: payload.updatedValue,
    remarks: payload.remarks,
    meta: {
      ...(payload.meta || {}),
      requestId: audit.requestId
    }
  });
}

function logEntityCreate({ module, entityId, entityLabel, action, description, user, meta, req }) {
  recordActivity({ module, entityId, entityLabel, action, description, user, meta, req });
}

function logEntityUpdate({
  module,
  entityId,
  entityLabel,
  action,
  description,
  user,
  meta,
  req,
  previousValue,
  updatedValue,
  remarks
}) {
  recordActivity({
    module,
    entityId,
    entityLabel,
    action,
    description,
    user,
    meta,
    req,
    previousValue,
    updatedValue,
    remarks
  });
}

function logStatusChange({
  module,
  entityId,
  entityLabel,
  previousStatus,
  newStatus,
  user,
  remarks,
  meta,
  req
}) {
  const description = `${entityLabel || 'Record'} status changed from ${previousStatus} to ${newStatus}`;
  recordActivity({
    module,
    entityId,
    entityLabel,
    action: ACTIONS.STATUS_CHANGE,
    description,
    user,
    req,
    previousValue: previousStatus,
    updatedValue: newStatus,
    remarks,
    meta: {
      previousStatus,
      newStatus,
      remarks: remarks || undefined,
      ...meta
    }
  });
}

function logDocumentAccess({ module, entityId, entityLabel, documentType, user, req, meta }) {
  recordActivity({
    module,
    entityId,
    entityLabel,
    action: ACTIONS.DOCUMENT_ACCESS,
    description: `Document accessed: ${documentType || 'file'} for ${entityLabel || entityId}`,
    user,
    req,
    meta: {
      documentType,
      ...meta
    }
  });
}

module.exports = {
  ACTIONS,
  auditOnCreate,
  auditOnUpdate,
  performerFromUser,
  buildActivityEntry,
  buildStatusChangeEntry,
  recordActivity,
  recordActivitySync,
  logEntityCreate,
  logEntityUpdate,
  logStatusChange,
  logDocumentAccess
};
