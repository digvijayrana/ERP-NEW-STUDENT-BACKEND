const User = require('../models/User');
const asyncHandler = require('../middleware/asyncHandler');
const { signToken } = require('../services/token.service');
const { getPermissionsForRole } = require('../services/permission.service');
const {
  ACTIONS,
  auditOnCreate,
  auditOnUpdate,
  logEntityCreate,
  logEntityUpdate,
  logStatusChange
} = require('../services/activityLog.service');
const { MODULES } = require('../constants/activityActions');
const { createLogger } = require('../utils/logger');
const { HTTP_STATUS, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');

const USER_SORT_FIELDS = ['name', 'email', 'role', 'createdAt'];

const log = createLogger('auth');

async function userWithPermissions(user) {
  const safe = user.toSafeJSON();
  safe.permissions = await getPermissionsForRole(user.role);
  return safe;
}

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email || '').toLowerCase() });
  if (!user || !user.isActive || !(await user.comparePassword(password || ''))) {
    log.warn('Login failed - invalid credentials', { email: String(email || '').toLowerCase(), ip: req.ip });
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Invalid email or password' });
  }

  user.lastLoginAt = new Date();
  await user.save();
  log.info('User logged in successfully', { email: user.email, role: user.role, ip: req.ip });
  res.json({ token: signToken(user), user: await userWithPermissions(user) });
});

exports.me = asyncHandler(async (req, res) => {
  res.json(await userWithPermissions(req.user));
});

exports.createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, teacher, student, linkedStudent, linkedStudents } = req.body;
  if (role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Only Super Admin can create Super Admin accounts' });
  }

  const userData = { name, email, role, passwordHash: 'pending' };
  if (teacher) userData.teacher = teacher;
  if (student) userData.student = student;
  const children = Array.isArray(linkedStudents) ? linkedStudents.filter(Boolean) : [];
  if (children.length) {
    userData.linkedStudents = children;
    userData.linkedStudent = children[0];
  } else if (linkedStudent) {
    userData.linkedStudent = linkedStudent;
    userData.linkedStudents = [linkedStudent];
  }
  const user = new User({ ...userData, ...auditOnCreate(req.user) });
  await user.setPassword(password);
  await user.save();
  log.info('New user account created', { email: user.email, role: user.role, createdBy: req.user?.email });

  logEntityCreate({
    module: MODULES.USERS,
    entityId: user._id,
    entityLabel: user.email,
    action: ACTIONS.ROLE_ASSIGNMENT,
    description: `User account created with role ${user.role}: ${user.email}`,
    user: req.user,
    meta: { role: user.role }
  });

  res.status(HTTP_STATUS.CREATED).json(await userWithPermissions(user));
});

exports.listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.status === 'inactive') filter.isActive = false;
  else if (req.query.status === 'active') filter.isActive = { $ne: false };
  if (req.query.search) {
    const term = req.query.search.trim();
    const regex = new RegExp(term, 'i');
    filter.$or = [{ name: regex }, { email: regex }];
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, USER_SORT_FIELDS, 'name');

  const [users, totalItems] = await Promise.all([
    User.find(filter).select('-passwordHash')
      .populate('teacher', 'firstName lastName')
      .populate('student', 'firstName lastName admissionNumber')
      .populate('linkedStudent', 'firstName lastName admissionNumber')
      .populate('linkedStudents', 'firstName lastName admissionNumber')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    User.countDocuments(filter)
  ]);

  return sendPaginated(res, users.map((user) => user.toSafeJSON()), { page, pageSize, totalItems });
});

exports.updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'User not found' });

  const previousRole = user.role;
  const previousActive = user.isActive;

  const { name, email, role, teacher, student, linkedStudent, linkedStudents, isActive } = req.body;
  if (role && role !== user.role) {
    if (req.user.role !== 'super_admin') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Only Super Admin can change user roles' });
    }
    if (role === 'super_admin' && req.user._id.toString() !== user._id.toString()) {
      // allow super admin to assign super_admin
    }
    user.role = role;
  }

  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (teacher !== undefined) user.teacher = teacher || undefined;
  if (student !== undefined) user.student = student || undefined;
  if (linkedStudents !== undefined) {
    user.linkedStudents = linkedStudents;
    user.linkedStudent = linkedStudents[0];
  } else if (linkedStudent !== undefined) {
    user.linkedStudent = linkedStudent;
    user.linkedStudents = linkedStudent ? [linkedStudent] : [];
  }
  if (isActive !== undefined) user.isActive = isActive;

  Object.assign(user, auditOnUpdate(req.user));
  await user.save();
  log.info('User updated', { userId: user._id, updatedBy: req.user.email });

  logEntityUpdate({
    module: MODULES.USERS,
    entityId: user._id,
    entityLabel: user.email,
    action: ACTIONS.UPDATE,
    description: `User account updated: ${user.email}`,
    user: req.user
  });

  if (role && role !== previousRole) {
    logEntityUpdate({
      module: MODULES.USERS,
      entityId: user._id,
      entityLabel: user.email,
      action: ACTIONS.ROLE_ASSIGNMENT,
      description: `User role changed from ${previousRole} to ${user.role}`,
      user: req.user,
      meta: { previousRole, newRole: user.role }
    });
  }

  if (isActive !== undefined && isActive !== previousActive) {
    logStatusChange({
      module: MODULES.USERS,
      entityId: user._id,
      entityLabel: user.email,
      previousStatus: previousActive ? 'active' : 'inactive',
      newStatus: user.isActive ? 'active' : 'inactive',
      user: req.user
    });
  }

  res.json(await userWithPermissions(user));
});

exports.deactivateUser = asyncHandler(async (req, res) => {
  const existing = await User.findById(req.params.id);
  if (!existing) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'User not found' });

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive: false, ...auditOnUpdate(req.user) },
    { new: true }
  );

  logStatusChange({
    module: MODULES.USERS,
    entityId: user._id,
    entityLabel: user.email,
    previousStatus: 'active',
    newStatus: 'inactive',
    user: req.user,
    remarks: 'User account deactivated'
  });

  log.info('User deactivated', { userId: user._id, by: req.user.email });
  res.json(await userWithPermissions(user));
});

exports.removeUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'User not found' });
  await User.deleteOne({ _id: user._id });
  log.info('User permanently deleted', { userId: user._id, by: req.user.email });
  res.json({ deleted: true });
});
