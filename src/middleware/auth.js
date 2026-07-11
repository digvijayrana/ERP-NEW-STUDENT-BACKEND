const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('./asyncHandler');
const { getPermissionsForRole, hasPermission } = require('../services/permission.service');
const { validateSession } = require('../services/security.service');
const { DEFAULTS, HTTP_STATUS, ROLES } = require('../constants');

const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PRINCIPAL];

function expandRoles(roles) {
  return roles.flatMap((role) => (role === ROLES.ADMIN ? ADMIN_ROLES : [role]));
}

exports.authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  // Prefer the Authorization header; fall back to an access_token query param so
  // that <img>/<a> tags can load protected files (e.g. student photos) which
  // cannot send custom headers.
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.query && req.query.access_token ? String(req.query.access_token) : null);
  if (!token) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Authentication required' });

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
    next();
  } catch {
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
