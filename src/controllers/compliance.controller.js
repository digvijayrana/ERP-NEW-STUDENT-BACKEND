const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS } = require('../constants');
const { getSecurityPolicy } = require('../services/security.service');
const { createBackup, listBackups } = require('../services/backup.service');
const { listRecentExceptions, getMonitoringSummary } = require('../services/errorMonitoring.service');
const { enqueueJob } = require('../services/jobQueue.service');
const { recordActivity } = require('../services/activityLog.service');
const { MODULES } = require('../constants/activityActions');
const complianceConfig = require('../config/compliance.config');

exports.status = asyncHandler(async (_req, res) => {
  res.json({
    framework: 'compliance-data-security',
    version: 1,
    securityPolicy: getSecurityPolicy(),
    backup: {
      enabled: complianceConfig.backup.enabled,
      retentionDays: complianceConfig.backup.retentionDays,
      scheduleCron: complianceConfig.backup.scheduleCron
    },
    masking: complianceConfig.masking,
    monitoring: getMonitoringSummary()
  });
});

exports.listBackups = asyncHandler(async (_req, res) => {
  res.json({ backups: listBackups() });
});

exports.runBackup = asyncHandler(async (req, res) => {
  const job = await enqueueJob('system_backup', { requestedBy: req.user?.email }, req.user);
  recordActivity({
    module: MODULES.GOVERNANCE,
    action: 'backup_started',
    description: 'System backup queued',
    user: req.user,
    req,
    meta: { jobId: job._id }
  });
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId: job._id, status: job.status });
});

exports.runBackupNow = asyncHandler(async (req, res) => {
  const result = await createBackup(req.user);
  recordActivity({
    module: MODULES.GOVERNANCE,
    action: 'backup_completed',
    description: 'System backup completed',
    user: req.user,
    req,
    meta: result.manifest
  });
  res.json(result);
});

exports.listExceptions = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 50;
  res.json({ exceptions: listRecentExceptions(limit), summary: getMonitoringSummary() });
});
