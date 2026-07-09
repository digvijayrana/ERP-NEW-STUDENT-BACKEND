module.exports = {
  CACHE_TTL_MS: {
    dashboard: 60_000,
    masterData: 120_000,
    governance: 30_000,
    globalSearch: 15_000,
    permissions: 60_000
  },
  AUDIT_RETENTION_DAYS: Number(process.env.AUDIT_RETENTION_DAYS) || 365,
  AUDIT_ARCHIVE_BATCH_SIZE: 500,
  BULK_BATCH_SIZE: 100,
  JOB_POLL_INTERVAL_MS: 2_000,
  MAX_CONCURRENT_JOBS: 2
};
