const winston = require('winston');
const Transport = require('winston-transport');
const { DEFAULTS, LOGGER, SERVICE_NAME } = require('../constants');

const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? DEFAULTS.LOG_LEVEL_PROD : DEFAULTS.LOG_LEVEL_DEV);

const readableFormat = winston.format.printf(({ timestamp, level, module, message, ...meta }) => {
  const metaKeys = Object.keys(meta).filter((key) => key !== 'service' && key !== 'splat');
  const metaText = metaKeys.length
    ? ` | ${metaKeys.map((key) => `${key}=${JSON.stringify(meta[key])}`).join(', ')}`
    : '';
  return `[${timestamp}] ${level.toUpperCase().padEnd(5)} [${module}] ${message}${metaText}`;
});

class SplunkHecTransport extends Transport {
  constructor(opts = {}) {
    super(opts);
    this.url = opts.url;
    this.token = opts.token;
    this.source = opts.source || SERVICE_NAME;
    this.sourceType = opts.sourceType || '_json';
    this.index = opts.index || 'main';
    this.batchSize = opts.batchSize || LOGGER.SPLUNK_BATCH_SIZE;
    this.flushInterval = opts.flushInterval || LOGGER.SPLUNK_FLUSH_INTERVAL_MS;
    this._buffer = [];
    this._timer = setInterval(() => this._flush(), this.flushInterval);
    this._timer.unref();
  }

  log(info, callback) {
    const event = {
      time: Date.now() / LOGGER.SPLUNK_EPOCH_DIVISOR,
      host: process.env.HOSTNAME || 'erp-backend',
      source: this.source,
      sourcetype: this.sourceType,
      index: this.index,
      event: {
        level: info.level,
        module: info.module,
        message: info.message,
        service: SERVICE_NAME,
        environment: process.env.NODE_ENV || DEFAULTS.NODE_ENV,
        ...info
      }
    };

    this._buffer.push(JSON.stringify(event));

    if (this._buffer.length >= this.batchSize) {
      this._flush();
    }

    callback();
  }

  _flush() {
    if (!this._buffer.length) return;

    const payload = this._buffer.join('\n');
    this._buffer = [];

    fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Splunk ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: payload
    }).catch(() => {
      // Splunk is optional; avoid noisy stderr when HEC is unreachable.
    });
  }

  close() {
    clearInterval(this._timer);
    this._flush();
  }
}

const cache = new Map();

function createLogger(moduleName) {
  if (cache.has(moduleName)) return cache.get(moduleName);

  const transports = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: LOGGER.TIMESTAMP_FORMAT }),
        readableFormat
      )
    })
  ];

  if (process.env.SPLUNK_HEC_URL && process.env.SPLUNK_HEC_TOKEN && process.env.SPLUNK_HEC_ENABLED === 'true') {
    transports.push(new SplunkHecTransport({
      url: process.env.SPLUNK_HEC_URL,
      token: process.env.SPLUNK_HEC_TOKEN,
      index: process.env.SPLUNK_INDEX || 'main',
      level: logLevel
    }));
  }

  const logger = winston.createLogger({
    level: logLevel,
    defaultMeta: { module: moduleName },
    transports
  });

  cache.set(moduleName, logger);
  return logger;
}

module.exports = { createLogger, SplunkHecTransport };
