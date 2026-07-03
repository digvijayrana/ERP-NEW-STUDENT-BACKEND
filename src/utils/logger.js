const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { DEFAULTS, LOGGER } = require('../constants');

const logsDir = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? DEFAULTS.LOG_LEVEL_PROD : DEFAULTS.LOG_LEVEL_DEV);

const readableFormat = winston.format.printf(({ timestamp, level, module, message, ...meta }) => {
  const metaKeys = Object.keys(meta).filter((key) => key !== 'service' && key !== 'splat');
  const metaText = metaKeys.length
    ? ` | ${metaKeys.map((key) => `${key}=${JSON.stringify(meta[key])}`).join(', ')}`
    : '';
  return `[${timestamp}] ${level.toUpperCase().padEnd(5)} [${module}] ${message}${metaText}`;
});

const cache = new Map();

function createLogger(moduleName) {
  if (cache.has(moduleName)) return cache.get(moduleName);

  const logger = winston.createLogger({
    level: logLevel,
    defaultMeta: { module: moduleName },
    transports: [
      new winston.transports.File({
        filename: path.join(logsDir, `${moduleName}.log`),
        format: winston.format.combine(
          winston.format.timestamp({ format: LOGGER.TIMESTAMP_FORMAT }),
          readableFormat
        ),
        maxsize: LOGGER.MAX_FILE_SIZE,
        maxFiles: LOGGER.MAX_FILES
      }),
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: LOGGER.TIMESTAMP_FORMAT }),
          readableFormat
        )
      })
    ]
  });

  cache.set(moduleName, logger);
  return logger;
}

module.exports = { createLogger, logsDir };
