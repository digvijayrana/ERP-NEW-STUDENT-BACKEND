module.exports = {
  masking: {
    aadhaar: {
      enabled: true,
      format: 'XXXX-XXXX-{last4}'
    }
  },
  documentAccess: {
    signedUrlTtlSeconds: Number(process.env.DOCUMENT_ACCESS_TTL_SECONDS) || 300
  },
  backup: {
    enabled: process.env.BACKUP_ENABLED !== 'false',
    scheduleCron: process.env.BACKUP_CRON || '0 2 * * *',
    retentionDays: Number(process.env.BACKUP_RETENTION_DAYS) || 30,
    outputDir: process.env.BACKUP_DIR || 'backups'
  },
  errorMonitoring: {
    alertThreshold: Number(process.env.ERROR_ALERT_THRESHOLD) || 5,
    alertWindowMinutes: Number(process.env.ERROR_ALERT_WINDOW_MINUTES) || 15
  }
};
