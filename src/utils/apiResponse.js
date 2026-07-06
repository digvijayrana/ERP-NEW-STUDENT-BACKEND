const { HTTP_STATUS } = require('../constants');

function sendSuccess(res, data, options = {}) {
  const payload = { success: true, data };
  if (options.message) payload.message = options.message;
  if (options.pagination) payload.pagination = options.pagination;
  return res.status(options.status || HTTP_STATUS.OK).json(payload);
}

function sendPaginated(res, data, { page, pageSize, totalItems }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return sendSuccess(res, data, {
    pagination: { page, pageSize, totalItems, totalPages }
  });
}

function sendError(res, status, message, options = {}) {
  const payload = {
    success: false,
    message,
    code: options.code,
    errors: options.errors,
    requestId: options.requestId
  };
  if (options.details) payload.details = options.details;
  return res.status(status).json(payload);
}

module.exports = { sendSuccess, sendPaginated, sendError };
