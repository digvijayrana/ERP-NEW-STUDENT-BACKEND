const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

const log = createLogger('http');

module.exports = function requestLogger(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const userLabel = req.user ? `${req.user.email} (${req.user.role})` : 'anonymous';
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level](`${req.method} ${req.originalUrl} -> ${res.statusCode} in ${durationMs}ms`, {
      requestId,
      user: userLabel,
      ip: req.ip
    });
  });

  next();
};
