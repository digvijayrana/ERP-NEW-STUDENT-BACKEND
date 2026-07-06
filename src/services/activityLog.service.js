const Activity = require('../models/Activity');
const { ACTIONS } = require('../constants/activityActions');
const { createLogger } = require('../utils/logger');
const { auditOnCreate, auditOnUpdate } = require('../utils/auditFields');

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

function recordActivity({ module, entityId, entityLabel, action, description, user, meta }) {
  const payload = {
    module,
    entityId,
    entityLabel,
    action,
    description,
    performedBy: performerFromUser(user),
    performedAt: new Date(),
    meta: meta || {}
  };

  setImmediate(() => {
    Activity.create(payload).catch((error) => {
      log.warn('Activity log write failed', { module, action, error: error.message });
    });
  });
}

function recordActivitySync(payload) {
  return Activity.create({
    ...payload,
    performedBy: performerFromUser(payload.user),
    performedAt: new Date()
  });
}

function logEntityCreate({ module, entityId, entityLabel, action, description, user, meta }) {
  recordActivity({ module, entityId, entityLabel, action, description, user, meta });
}

function logEntityUpdate({ module, entityId, entityLabel, action, description, user, meta }) {
  recordActivity({ module, entityId, entityLabel, action, description, user, meta });
}

function logStatusChange({ module, entityId, entityLabel, previousStatus, newStatus, user, remarks, meta }) {
  const description = `${entityLabel || 'Record'} status changed from ${previousStatus} to ${newStatus}`;
  recordActivity({
    module,
    entityId,
    entityLabel,
    action: ACTIONS.STATUS_CHANGE,
    description,
    user,
    meta: {
      previousStatus,
      newStatus,
      remarks: remarks || undefined,
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
  logStatusChange
};
