const { HTTP_STATUS } = require('../constants');

function versionConflictError(message = 'Record was modified by another user. Please refresh and try again.') {
  const error = new Error(message);
  error.status = HTTP_STATUS.CONFLICT;
  error.code = 'VERSION_CONFLICT';
  return error;
}

function assertOptimisticVersion(document, clientVersion) {
  if (clientVersion === undefined || clientVersion === null || clientVersion === '') return;
  const current = document.__v ?? document.version;
  const expected = Number(clientVersion);
  if (Number.isNaN(expected)) return;
  if (current !== undefined && current !== expected) {
    throw versionConflictError();
  }
}

function attachVersion(payload, document) {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    __v: document.__v,
    version: document.version ?? document.__v
  };
}

module.exports = {
  assertOptimisticVersion,
  attachVersion,
  versionConflictError
};
