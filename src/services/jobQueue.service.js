const BackgroundJob = require('../models/BackgroundJob');
const { BULK_BATCH_SIZE, JOB_POLL_INTERVAL_MS, MAX_CONCURRENT_JOBS } = require('../config/performance.config');
const { archiveActivities } = require('./activityArchive.service');
const { recordActivity } = require('./activityLog.service');
const { MODULES } = require('../constants/activityActions');

const handlers = {
  activity_archive: async (job) => {
    const result = await archiveActivities(job.payload || {});
    return result;
  },
  bulk_notification: async (job) => {
    const { studentIds = [], message, channel = 'in_app' } = job.payload || {};
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { queued: studentIds.length, channel, message };
  },
  csv_export: async (job) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { exported: true, rows: job.payload?.rows?.length || 0 };
  },
  report_export: async (job) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { exported: true, domain: job.payload?.domain, type: job.payload?.type };
  },
  pdf_generation: async (job) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return { generated: true, target: job.payload?.target };
  },
  email_notification: async (job) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { sent: true, recipients: job.payload?.recipients?.length || 0 };
  },
  bulk_export: async (job) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { exported: job.payload?.count || 0 };
  },
  system_backup: async (job) => {
    const { createBackup } = require('./backup.service');
    return createBackup({ email: job.payload?.requestedBy || 'system' });
  }
};

let activeJobs = 0;
let workerStarted = false;

async function enqueueJob(type, payload, user) {
  const job = await BackgroundJob.create({
    type,
    status: 'queued',
    payload,
    requestedBy: user?._id || user?.id,
    createdBy: user?._id || user?.id,
    updatedBy: user?._id || user?.id
  });
  ensureWorker();
  return job;
}

async function processJob(jobId) {
  const job = await BackgroundJob.findById(jobId);
  if (!job || job.status !== 'queued') return;

  const handler = handlers[job.type];
  if (!handler) {
    job.status = 'failed';
    job.errorMessage = `Unsupported job type: ${job.type}`;
    job.completedAt = new Date();
    await job.save();
    return;
  }

  job.status = 'processing';
  job.startedAt = new Date();
  job.progress = 10;
  await job.save();

  try {
    const result = await handler(job);
    job.status = 'completed';
    job.progress = 100;
    job.result = result;
    job.completedAt = new Date();
    await job.save();
  } catch (error) {
    job.status = 'failed';
    job.errorMessage = error.message;
    job.completedAt = new Date();
    await job.save();
  }
}

async function pollQueue() {
  if (activeJobs >= MAX_CONCURRENT_JOBS) return;
  const next = await BackgroundJob.findOne({ status: 'queued' }).sort({ createdAt: 1 });
  if (!next) return;

  activeJobs += 1;
  try {
    await processJob(next._id);
  } finally {
    activeJobs -= 1;
  }
}

function ensureWorker() {
  if (workerStarted) return;
  workerStarted = true;
  setInterval(() => {
    pollQueue().catch(() => {});
  }, JOB_POLL_INTERVAL_MS);
}

async function getJob(jobId) {
  return BackgroundJob.findById(jobId).lean();
}

async function listJobs(user, limit = 20) {
  const filter = user?.role === 'super_admin' || user?.role === 'admin'
    ? {}
    : { requestedBy: user?._id || user?.id };
  return BackgroundJob.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
}

function chunkArray(items, size = BULK_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

module.exports = {
  enqueueJob,
  getJob,
  listJobs,
  chunkArray,
  ensureWorker
};
