const { createLogger } = require('../utils/logger');
const { HTTP_STATUS, DB } = require('../constants');

const log = createLogger('errors');

module.exports = function errorHandler(err, req, res, _next) {
  const isValidationError = err.name === 'ValidationError' || err.name === 'CastError' || err.code === DB.MONGOOSE_DUPLICATE_KEY_CODE;
  const status = err.status || (isValidationError ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.INTERNAL_SERVER_ERROR);
  const message = err.code === DB.MONGOOSE_DUPLICATE_KEY_CODE ? 'Duplicate record found' : err.message || 'Something went wrong';

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
