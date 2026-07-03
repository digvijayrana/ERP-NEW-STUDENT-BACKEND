const app = require('./app');
const connectDb = require('./config/db');
const { createLogger } = require('./utils/logger');

const log = createLogger('server');
const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || '0.0.0.0';

async function startServer(portToUse) {
  try {
    await connectDb();
    const server = app.listen(portToUse, host, () => {
      log.info(`Student ERP API is running`, { url: `http://${host}:${portToUse}`, env: process.env.NODE_ENV || 'development' });
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        const fallbackPort = portToUse + 1;
        if (fallbackPort <= portToUse + 5) {
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
