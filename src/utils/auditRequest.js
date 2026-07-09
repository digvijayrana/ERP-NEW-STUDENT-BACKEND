function auditContextFromRequest(req) {
  if (!req) return {};
  const forwarded = req.headers['x-forwarded-for'];
  const ipAddress = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') || req.ip || '';
  return {
    ipAddress,
    userAgent: req.headers['user-agent'] || '',
    requestId: req.requestId
  };
}

module.exports = {
  auditContextFromRequest
};
