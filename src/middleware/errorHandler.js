const { createLogger } = require('../utils/logger');
const { sendError } = require('../utils/apiResponse');
const { duplicateKeyField } = require('../utils/pagination');
const { recordException } = require('../services/errorMonitoring.service');
const { HTTP_STATUS, DB } = require('../constants');

const log = createLogger('errors');

function mapValidationErrors(err) {
  if (err.name !== 'ValidationError' || !err.errors) return null;
  return Object.entries(err.errors).map(([field, detail]) => ({
    field,
    message: detail.message
  }));
}

function classifyErrorType(err, status) {
  if (err.name === 'ValidationError' || err.name === 'CastError') return 'validation_error';
  if (status === HTTP_STATUS.UNAUTHORIZED) return 'authentication_failure';
  if (status === HTTP_STATUS.FORBIDDEN) return 'authorization_failure';
  if (err.code === DB.MONGOOSE_DUPLICATE_KEY_CODE) return 'database_error';
  if (status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) return 'unhandled_exception';
  return 'api_error';
}

module.exports = function errorHandler(err, req, res, _next) {
  const validationErrors = mapValidationErrors(err);
  const isValidationError = err.name === 'ValidationError' || err.name === 'CastError' || err.code === DB.MONGOOSE_DUPLICATE_KEY_CODE;
  const status = err.status || (isValidationError ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.INTERNAL_SERVER_ERROR);

  let message = err.message || 'Something went wrong';
  let code = err.code;

  if (err.code === DB.MONGOOSE_DUPLICATE_KEY_CODE) {
    message = duplicateKeyField(err);
    code = 'DUPLICATE_RECORD';
  } else if (status === HTTP_STATUS.UNAUTHORIZED) {
    code = code || 'UNAUTHORIZED';
  } else if (status === HTTP_STATUS.FORBIDDEN) {
    code = code || 'FORBIDDEN';
  } else if (status === HTTP_STATUS.NOT_FOUND) {
    code = code || 'NOT_FOUND';
  } else if (validationErrors?.length) {
    code = 'VALIDATION_ERROR';
    message = validationErrors[0].message;
  } else if (status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
    code = 'INTERNAL_ERROR';
    message = process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : message;
  }

  const errorType = classifyErrorType(err, status);

  recordException({
    type: errorType,
    message,
    status,
    code,
    path: req.originalUrl,
    method: req.method,
    requestId: req.requestId,
    user: req.user,
    req,
    stack: err.stack
  });

  log.error(message, {
    status,
    code,
    type: errorType,
    requestId: req.requestId,
    path: req.originalUrl,
    method: req.method,
    user: req.user?.email,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });

  return sendError(res, status, message, {
    code,
    errors: validationErrors || undefined,
    details: err.details,
    requestId: req.requestId
  });
};
