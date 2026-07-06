const app = require('./app');
const connectDb = require('./config/db');
const { createLogger } = require('./utils/logger');
const { checkStorageHealth, getStorageInfo } = require('./services/documentStorage.service');
const { DEFAULTS, FALLBACK_PORT_RETRIES } = require('./constants');

const log = createLogger('server');
const port = Number(process.env.PORT || DEFAULTS.PORT);
const host = process.env.HOST || DEFAULTS.HOST;

async function startServer(portToUse) {
  try {
    await connectDb();

    const storageInfo = getStorageInfo();
    const storageHealth = await checkStorageHealth();
    if (storageHealth.ok) {
      log.info('Document storage ready', { driver: storageInfo.driver, detail: storageHealth });
    } else {
      log.warn('Document storage unavailable — preview/download will fail until fixed', {
        driver: storageInfo.driver,
        message: storageHealth.message,
        hint: storageInfo.driver === 's3' && storageHealth.backend === 'aws'
          ? 'Set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION, S3_BUCKET in backend/.env'
          : storageInfo.driver === 's3'
            ? 'Run: docker compose -f docker-compose.infra.yml up -d minio minio-init — or use AWS S3 (clear S3_ENDPOINT)'
            : 'Set STORAGE_DRIVER=local in .env for filesystem storage without S3'
      });
    }

    const server = app.listen(portToUse, host, () => {
      log.info(`Student ERP API is running`, {
        url: `http://${host}:${portToUse}`,
        env: process.env.NODE_ENV || DEFAULTS.NODE_ENV
      });
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        const fallbackPort = portToUse + 1;
        if (fallbackPort <= portToUse + FALLBACK_PORT_RETRIES) {
          log.warn(`Port ${portToUse} is busy, retrying on ${fallbackPort}`);
          server.close(() => startServer(fallbackPort));
          return;
        }
      }
      log.error('Server failed to start', { error: error.message });
      process.exit(1);
    });
  } catch (error) {
    log.error('Failed to initialize server', { error: error.message });
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

startServer(port);
