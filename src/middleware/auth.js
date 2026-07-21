const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('./asyncHandler');
const { getPermissionsForRole, hasPermission } = require('../services/permission.service');
const { validateSession } = require('../services/security.service');
const { resolveAccessToken } = require('../services/documentAccess.service');
const { DEFAULTS, HTTP_STATUS, ROLES } = require('../constants');

const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PRINCIPAL];

function expandRoles(roles) {
  return roles.flatMap((role) => (role === ROLES.ADMIN ? ADMIN_ROLES : [role]));
}

async function attachUserFromDocumentAccessToken(req) {
  const raw = req.query?.accessToken;
  if (!raw) return false;

  // Document tokens must only authenticate document file downloads, never other APIs.
  const path = `${req.baseUrl || ''}${req.path || ''}`;
  if (!/\/documents\/[^/]+\/file\/?$/.test(path) && !/\/documents\/[^/]+\/file\/?$/.test(req.path || '')) {
    return false;
  }

  const entry = resolveAccessToken(String(raw));
  if (!entry) return false;

  const user = await User.findById(entry.userId).select('-passwordHash');
  if (!user || !user.isActive) return false;

  req.user = user;
  req.permissions = await getPermissionsForRole(user.role);
  req.documentAccessEntry = entry;
  return true;
}

exports.authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  // Prefer the Authorization header; fall back to an access_token query param so
  // that <img>/<a> tags can load protected files (e.g. student photos) which
  // cannot send custom headers.
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.query && req.query.access_token ? String(req.query.access_token) : null);

  if (!token) {
    // Short-lived signed document URLs use ?accessToken= (not JWT).
    if (await attachUserFromDocumentAccessToken(req)) return next();
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || DEFAULTS.JWT_SECRET_FALLBACK);
    const user = await User.findById(decoded.sub).select('-passwordHash');
    if (!user || !user.isActive) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Invalid or disabled user' });

    if ((decoded.sv || 0) !== (user.securityVersion || 0)) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Session expired. Please sign in again.' });
    }

    if (decoded.sid) {
      const session = await validateSession(decoded.sid, user._id);
      if (!session) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Session expired or revoked. Please sign in again.' });
      }
      req.sessionId = decoded.sid;
    }

    req.user = user;
    req.permissions = await getPermissionsForRole(user.role);

    // Optional: also attach document access entry when both JWT and accessToken are present
    if (req.query?.accessToken) {
      const entry = resolveAccessToken(String(req.query.accessToken));
      if (entry) req.documentAccessEntry = entry;
    }

    next();
  } catch {
    // JWT invalid — still allow a valid document accessToken (e.g. expired session, open signed link)
    if (await attachUserFromDocumentAccessToken(req)) return next();
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Invalid or expired token' });
  }
});

exports.authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Authentication required' });
  const allowed = expandRoles(roles);
  if (!allowed.includes(req.user.role) && req.user.role !== ROLES.SUPER_ADMIN) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'You do not have permission for this action' });
  }
  next();
};

exports.requirePermission = (module, action) => asyncHandler(async (req, res, next) => {
  if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Authentication required' });

  const permissions = req.permissions || (await getPermissionsForRole(req.user.role));
  req.permissions = permissions;

  if (req.user.role === ROLES.SUPER_ADMIN || hasPermission(permissions, module, action)) {
    return next();
  }

  return res.status(HTTP_STATUS.FORBIDDEN).json({
    message: `You do not have permission to ${action} ${module.replace(/_/g, ' ')}`
  });
});

exports.requireSuperAdmin = (req, res, next) => {
  if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Authentication required' });
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Only Super Admin can perform this action' });
  }
  next();
};

exports.requireUnlock = (module) => exports.requirePermission(module, 'unlock');
exports.requireApprove = (module) => exports.requirePermission(module, 'approve');
