const crypto = require('crypto');
const complianceConfig = require('../config/compliance.config');
const { DEFAULTS, HTTP_STATUS } = require('../constants');
const { createAppError, rethrowMeaningful } = require('../utils/appError');

const ttlMs = (complianceConfig.documentAccess?.signedUrlTtlSeconds || 300) * 1000;

function signingSecret() {
  try {
    return process.env.JWT_SECRET || DEFAULTS.JWT_SECRET_FALLBACK || 'document-access-secret';
  } catch (error) {
    rethrowMeaningful('signingSecret', error, 'Failed to resolve document token signing secret');
  }
}

function getAccessTtlSeconds() {
  try {
    return complianceConfig.documentAccess?.signedUrlTtlSeconds || 300;
  } catch (error) {
    rethrowMeaningful('getAccessTtlSeconds', error, 'Failed to read document access TTL');
  }
}

/**
 * Issue a self-contained HMAC-signed access token (works across instances / restarts).
 */
function issueAccessToken({ userId, resourceType, resourceId, documentId }) {
  try {
    if (!userId || !resourceType || !resourceId || documentId == null) {
      throw createAppError(
        'userId, resourceType, resourceId and documentId are required to issue a document access token',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_TOKEN_PAYLOAD'
      );
    }

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
  } catch (error) {
    rethrowMeaningful('issueAccessToken', error, 'Failed to issue document access token');
  }
}

function resolveAccessToken(token) {
  try {
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
  } catch (error) {
    rethrowMeaningful('resolveAccessToken', error, 'Failed to resolve document access token');
  }
}

function validateAccessToken(token, { userId, resourceType, resourceId, documentId }) {
  try {
    const entry = resolveAccessToken(token);
    if (!entry) return false;
    return (
      entry.userId === String(userId)
      && entry.resourceType === resourceType
      && entry.resourceId === String(resourceId)
      && entry.documentId === String(documentId)
    );
  } catch (error) {
    rethrowMeaningful('validateAccessToken', error, 'Failed to validate document access token');
  }
}

/**
 * Public API origin for signed document URLs (must be reachable by browsers).
 */
function buildPublicApiBaseUrl(req) {
  try {
    const fromEnv = (process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || '').trim().replace(/\/$/, '');
    if (fromEnv) return fromEnv;

    const protoHeader = req?.get?.('x-forwarded-proto');
    const proto = (protoHeader ? protoHeader.split(',')[0].trim() : null)
      || req?.protocol
      || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
    const host = (req?.get?.('x-forwarded-host') || req?.get?.('host') || '').split(',')[0].trim();
    if (!host) {
      throw createAppError(
        'Unable to build public API URL: set PUBLIC_API_URL or ensure the request Host header is present',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        'MISSING_PUBLIC_API_URL'
      );
    }
    return `${proto}://${host}/api`;
  } catch (error) {
    rethrowMeaningful('buildPublicApiBaseUrl', error, 'Failed to build public API base URL');
  }
}

function buildDocumentFileUrl(req, pathWithLeadingSlash, accessToken) {
  try {
    if (!accessToken) {
      throw createAppError('Document access token is required to build file URL', HTTP_STATUS.BAD_REQUEST, 'MISSING_ACCESS_TOKEN');
    }
    const base = buildPublicApiBaseUrl(req);
    const path = pathWithLeadingSlash.startsWith('/') ? pathWithLeadingSlash : `/${pathWithLeadingSlash}`;
    return `${base}${path}?accessToken=${encodeURIComponent(accessToken)}`;
  } catch (error) {
    rethrowMeaningful('buildDocumentFileUrl', error, 'Failed to build document file URL');
  }
}

module.exports = {
  issueAccessToken,
  resolveAccessToken,
  validateAccessToken,
  getAccessTtlSeconds,
  buildPublicApiBaseUrl,
  buildDocumentFileUrl
};
