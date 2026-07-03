const User = require('../models/User');
const asyncHandler = require('../middleware/asyncHandler');
const { signToken } = require('../services/token.service');
const { createLogger } = require('../utils/logger');

const log = createLogger('auth');

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email || '').toLowerCase() });
  if (!user || !user.isActive || !(await user.comparePassword(password || ''))) {
    log.warn('Login failed - invalid credentials', { email: String(email || '').toLowerCase(), ip: req.ip });
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  user.lastLoginAt = new Date();
  await user.save();
  log.info('User logged in successfully', { email: user.email, role: user.role, ip: req.ip });
  res.json({ token: signToken(user), user: user.toSafeJSON() });
});

exports.me = asyncHandler(async (req, res) => {
  res.json(req.user);
});

exports.createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, teacher, student, linkedStudent } = req.body;
  const user = new User({ name, email, role, teacher, student, linkedStudent, passwordHash: 'pending' });
  await user.setPassword(password);
  await user.save();
  log.info('New user account created', { email: user.email, role: user.role, createdBy: req.user?.email });
  res.status(201).json(user.toSafeJSON());
});

exports.listUsers = asyncHandler(async (_req, res) => {
  const users = await User.find().select('-passwordHash')
    .populate('teacher', 'firstName lastName')
    .populate('student', 'firstName lastName admissionNumber')
    .populate('linkedStudent', 'firstName lastName admissionNumber');
  res.json(users);
});
