const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('./asyncHandler');
const { getPermissionsForRole, hasPermission } = require('../services/permission.service');
const { DEFAULTS, HTTP_STATUS } = require('../constants');

const ADMIN_ROLES = ['admin', 'super_admin'];

function expandRoles(roles) {
  return roles.flatMap((role) => (role === 'admin' ? ADMIN_ROLES : [role]));
}

exports.authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Authentication required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || DEFAULTS.JWT_SECRET_FALLBACK);
    const user = await User.findById(decoded.sub).select('-passwordHash');
    if (!user || !user.isActive) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Invalid or disabled user' });

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
  if (!allowed.includes(req.user.role)) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'You do not have permission for this action' });
  }
  next();
};

exports.requirePermission = (module, action) => asyncHandler(async (req, res, next) => {
  if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Authentication required' });

  const permissions = req.permissions || (await getPermissionsForRole(req.user.role));
  req.permissions = permissions;

  if (req.user.role === 'super_admin' || hasPermission(permissions, module, action)) {
    return next();
  }

  return res.status(HTTP_STATUS.FORBIDDEN).json({
    message: `You do not have permission to ${action} ${module.replace(/_/g, ' ')}`
  });
});

exports.requireSuperAdmin = (req, res, next) => {
  if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Authentication required' });
  if (req.user.role !== 'super_admin') {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Only Super Admin can perform this action' });
  }
  next();
};
