const { createLogger } = require('../utils/logger');
const complianceConfig = require('../config/compliance.config');
const { recordActivity } = require('./activityLog.service');

const log = createLogger('error-monitor');

const recentErrors = [];
const MAX_STORED = 200;

function sanitizeDetails(details = {}) {
  const blocked = new Set(['password', 'passwordHash', 'token', 'authorization', 'aadhaarNumber']);
  const clean = {};
  for (const [key, value] of Object.entries(details)) {
    if (blocked.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function recordException({
  type,
  message,
  status,
  code,
  path,
  method,
  requestId,
  user,
  req,
  stack
}) {
  const entry = {
    type,
    message,
    status,
    code,
    path,
    method,
    requestId,
    user: user?.email,
    role: user?.role,
    at: new Date().toISOString(),
    stack: process.env.NODE_ENV === 'production' ? undefined : stack
  };

  recentErrors.unshift(entry);
  if (recentErrors.length > MAX_STORED) recentErrors.length = MAX_STORED;

  log.error(message, sanitizeDetails({ type, status, code, path, method, requestId, user: user?.email }));

  const windowMs = complianceConfig.errorMonitoring.alertWindowMinutes * 60 * 1000;
  const threshold = complianceConfig.errorMonitoring.alertThreshold;
  const criticalCount = recentErrors.filter((item) => {
    const age = Date.now() - new Date(item.at).getTime();
    return age <= windowMs && (item.status >= 500 || item.type === 'unhandled_exception');
  }).length;

  if (criticalCount >= threshold) {
    recordActivity({
      module: 'governance',
      action: 'exception_alert',
      description: `Critical exception threshold reached (${criticalCount} in ${complianceConfig.errorMonitoring.alertWindowMinutes}m)`,
      user,
      req,
      meta: { criticalCount, latest: entry }
    });
    log.warn('Exception alert threshold reached', { criticalCount, threshold });
  }

  return entry;
}

function listRecentExceptions(limit = 50) {
  return recentErrors.slice(0, limit);
}

function getMonitoringSummary() {
  const windowMs = complianceConfig.errorMonitoring.alertWindowMinutes * 60 * 1000;
  const now = Date.now();
  const inWindow = recentErrors.filter((item) => now - new Date(item.at).getTime() <= windowMs);
  return {
    totalStored: recentErrors.length,
    recentWindowMinutes: complianceConfig.errorMonitoring.alertWindowMinutes,
    recentCount: inWindow.length,
    criticalCount: inWindow.filter((item) => item.status >= 500 || item.type === 'unhandled_exception').length,
    authFailures: inWindow.filter((item) => item.status === 401 || item.status === 403).length,
    latest: recentErrors[0] || null
  };
}

module.exports = {
  recordException,
  listRecentExceptions,
  getMonitoringSummary
};
