const { HTTP_STATUS } = require('../constants');

function reportReadOnlyGuard(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).json({
      message: 'Reports are read-only and cannot modify business records',
      code: 'REPORT_READ_ONLY'
    });
  }
  req.reportReadOnly = true;
  next();
}

module.exports = {
  reportReadOnlyGuard
};
