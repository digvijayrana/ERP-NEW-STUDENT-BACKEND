const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('./asyncHandler');
const { DEFAULTS, HTTP_STATUS } = require('../constants');

exports.authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Authentication required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || DEFAULTS.JWT_SECRET_FALLBACK);
    const user = await User.findById(decoded.sub).select('-passwordHash');
    if (!user || !user.isActive) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Invalid or disabled user' });
    req.user = user;
    next();
  } catch {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Invalid or expired token' });
  }
});

exports.authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Authentication required' });
  if (!roles.includes(req.user.role)) return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'You do not have permission for this action' });
  next();
};
