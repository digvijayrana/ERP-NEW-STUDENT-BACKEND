const { createLogger } = require('../utils/logger');

const log = createLogger('errors');

module.exports = function errorHandler(err, req, res, _next) {
  const status = err.status || (err.name === 'ValidationError' || err.name === 'CastError' || err.code === 11000 ? 400 : 500);
  const message = err.code === 11000 ? 'Duplicate record found' : err.message || 'Something went wrong';

  log.error(message, {
    status,
    requestId: req.requestId,
    path: req.originalUrl,
    method: req.method,
    user: req.user?.email,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });

  res.status(status).json({
    message,
    requestId: req.requestId,
    details: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
};
