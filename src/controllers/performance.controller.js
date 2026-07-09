const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS } = require('../constants');
const { enqueueJob, getJob, listJobs } = require('../services/jobQueue.service');
const { archiveActivities, searchArchivedActivities } = require('../services/activityArchive.service');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery } = require('../utils/pagination');
const { invalidateNamespace } = require('../services/cache.service');

exports.listJobs = asyncHandler(async (req, res) => {
  const jobs = await listJobs(req.user, Number(req.query.limit) || 20);
  res.json({ jobs });
});

exports.getJob = asyncHandler(async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Job not found' });
  res.json(job);
});

exports.enqueue = asyncHandler(async (req, res) => {
  const { type, payload } = req.body;
  if (!type) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Job type is required' });
  const job = await enqueueJob(type, payload || {}, req.user);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId: job._id, status: job.status, type: job.type });
});

exports.archiveAuditLogs = asyncHandler(async (req, res) => {
  const job = await enqueueJob('activity_archive', {
    retentionDays: Number(req.body.retentionDays) || undefined,
    batchSize: Number(req.body.batchSize) || undefined
  }, req.user);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId: job._id, status: job.status });
});

exports.searchArchivedAudit = asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePaginationQuery(req.query);
  const result = await searchArchivedActivities({
    module: req.query.module,
    action: req.query.action,
    search: req.query.search,
    skip,
    limit: pageSize
  });
  return sendPaginated(res, result.items, { page, pageSize, totalItems: result.totalItems });
});

exports.invalidateCache = asyncHandler(async (req, res) => {
  const namespace = req.body.namespace || 'all';
  if (namespace === 'all') {
    ['dashboard', 'masterData', 'governance', 'globalSearch', 'permissions'].forEach(invalidateNamespace);
  } else {
    invalidateNamespace(namespace);
  }
  res.json({ invalidated: namespace });
});
