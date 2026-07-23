const { HTTP_STATUS } = require('../constants');
const { createLogger } = require('./logger');

const log = createLogger('app-errors');

/**
 * Build a structured application error with HTTP status and code.
 */
function createAppError(message, status = HTTP_STATUS.INTERNAL_SERVER_ERROR, code = 'APP_ERROR', cause = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

/**
 * Re-throw business errors as-is; wrap unexpected errors with context.
 */
function rethrowMeaningful(fnName, error, fallbackMessage, status = HTTP_STATUS.INTERNAL_SERVER_ERROR) {
  if (error?.status || error?.statusCode) {
    throw error;
  }

  log.error(`${fnName} failed`, {
    function: fnName,
    message: error?.message,
    stack: error?.stack
  });

  throw createAppError(
    `${fallbackMessage} (${fnName}): ${error?.message || 'unexpected error'}`,
    status,
    error?.code || 'UNEXPECTED_ERROR',
    error
  );
}

/**
 * Express-safe: send JSON error or forward to next().
 */
function respondWithError(res, next, error, fallbackMessage = 'Request failed') {
  const status = error?.status || error?.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const message = error?.message || fallbackMessage;

  if (typeof next === 'function' && status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
    return next(error);
  }

  return res.status(status).json({
    message,
    code: error?.code || (status === HTTP_STATUS.FORBIDDEN ? 'FORBIDDEN' : 'REQUEST_ERROR')
  });
}

module.exports = {
  createAppError,
  rethrowMeaningful,
  respondWithError
};
