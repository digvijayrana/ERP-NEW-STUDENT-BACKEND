const crypto = require('crypto');
const complianceConfig = require('../config/compliance.config');

const ttlMs = (complianceConfig.documentAccess?.signedUrlTtlSeconds || 300) * 1000;
const tokens = new Map();

function issueAccessToken({ userId, resourceType, resourceId, documentId }) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, {
    userId: String(userId),
    resourceType,
    resourceId: String(resourceId),
    documentId: String(documentId),
    expiresAt: Date.now() + ttlMs
  });
  return token;
}

function validateAccessToken(token, { userId, resourceType, resourceId, documentId }) {
  const entry = tokens.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return false;
  }
  return (
    entry.userId === String(userId)
    && entry.resourceType === resourceType
    && entry.resourceId === String(resourceId)
    && entry.documentId === String(documentId)
  );
}

function purgeExpiredTokens() {
  const now = Date.now();
  for (const [token, entry] of tokens.entries()) {
    if (entry.expiresAt <= now) tokens.delete(token);
  }
}

setInterval(purgeExpiredTokens, 60_000).unref();

module.exports = {
  issueAccessToken,
  validateAccessToken,
  getAccessTtlSeconds: () => complianceConfig.documentAccess.signedUrlTtlSeconds
};
