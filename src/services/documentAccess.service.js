const crypto = require('crypto');
const complianceConfig = require('../config/compliance.config');
const { DEFAULTS } = require('../constants');

const ttlMs = (complianceConfig.documentAccess?.signedUrlTtlSeconds || 300) * 1000;

function signingSecret() {
  return process.env.JWT_SECRET || DEFAULTS.JWT_SECRET_FALLBACK || 'document-access-secret';
}

function getAccessTtlSeconds() {
  return complianceConfig.documentAccess.signedUrlTtlSeconds;
}

/**
 * Issue a self-contained HMAC-signed access token (works across instances / restarts).
 */
function issueAccessToken({ userId, resourceType, resourceId, documentId }) {
  const payload = {
    userId: String(userId),
    resourceType,
    resourceId: String(resourceId),
    documentId: String(documentId),
    exp: Date.now() + ttlMs
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function resolveAccessToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const entry = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!entry?.exp || Date.now() > entry.exp) return null;
    if (!entry.userId || !entry.resourceType || !entry.resourceId || entry.documentId == null) return null;
    return {
      userId: String(entry.userId),
      resourceType: entry.resourceType,
      resourceId: String(entry.resourceId),
      documentId: String(entry.documentId),
      expiresAt: entry.exp
    };
  } catch {
    return null;
  }
}

function validateAccessToken(token, { userId, resourceType, resourceId, documentId }) {
  const entry = resolveAccessToken(token);
  if (!entry) return false;
  return (
    entry.userId === String(userId)
    && entry.resourceType === resourceType
    && entry.resourceId === String(resourceId)
    && entry.documentId === String(documentId)
  );
}

/**
 * Public API origin for signed document URLs (must be reachable by browsers).
 * Prefer PUBLIC_API_URL in production (e.g. https://api.example.com/api).
 */
function buildPublicApiBaseUrl(req) {
  const fromEnv = (process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  const protoHeader = req.get('x-forwarded-proto');
  const proto = (protoHeader ? protoHeader.split(',')[0].trim() : null)
    || req.protocol
    || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}/api`;
}

function buildDocumentFileUrl(req, pathWithLeadingSlash, accessToken) {
  const base = buildPublicApiBaseUrl(req);
  const path = pathWithLeadingSlash.startsWith('/') ? pathWithLeadingSlash : `/${pathWithLeadingSlash}`;
  return `${base}${path}?accessToken=${encodeURIComponent(accessToken)}`;
}

module.exports = {
  issueAccessToken,
  resolveAccessToken,
  validateAccessToken,
  getAccessTtlSeconds,
  buildPublicApiBaseUrl,
  buildDocumentFileUrl
};
