const crypto = require('crypto');
const User = require('../models/User');
const Role = require('../models/Role');
const asyncHandler = require('../middleware/asyncHandler');
const { signToken } = require('../services/token.service');
const { getPermissionsForRole, assertAssignableRole } = require('../services/permission.service');
const {
  assertValidPassword,
  isPasswordExpired,
  isAccountLocked,
  recordFailedLogin,
  clearFailedLogin,
  createSession,
  revokeSession,
  revokeAllSessions,
  computePasswordExpiry,
  getSecurityPolicy
} = require('../services/security.service');
const {
  ACTIONS,
  auditOnCreate,
  auditOnUpdate,
  logEntityCreate,
  logEntityUpdate,
  logStatusChange,
  recordActivity
} = require('../services/activityLog.service');
const { MODULES } = require('../constants/activityActions');
const { createLogger } = require('../utils/logger');
const { HTTP_STATUS, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');

const USER_SORT_FIELDS = ['name', 'email', 'role', 'createdAt'];
const AUTH_MODULE = 'auth';

const log = createLogger('auth');

function generateTemporaryPassword() {
  return `Tmp@${crypto.randomBytes(4).toString('hex')}9`;
}

async function userWithPermissions(user) {
  const safe = user.toSafeJSON();
  safe.permissions = await getPermissionsForRole(user.role);
  safe.securityPolicy = getSecurityPolicy();
  safe.passwordExpired = isPasswordExpired(user);
  return safe;
}

exports.securityPolicy = asyncHandler(async (_req, res) => {
  res.json(getSecurityPolicy());
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || '').toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  if (!user || !user.isActive) {
    log.warn('Login failed - invalid credentials', { email: normalizedEmail, ip: req.ip });
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Invalid email or password' });
  }

  if (isAccountLocked(user)) {
    recordActivity({
      module: AUTH_MODULE,
      entityId: user._id,
      entityLabel: user.email,
      action: 'login_blocked_locked',
      description: `Login blocked for locked account ${user.email}`,
      user: { email: user.email, role: user.role },
      req,
      meta: { lockedUntil: user.lockedUntil }
    });
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      message: 'Account is temporarily locked due to failed login attempts',
      lockedUntil: user.lockedUntil
    });
  }

  const valid = await user.comparePassword(password || '');
  if (!valid) {
    await recordFailedLogin(user, req);
    log.warn('Login failed - invalid credentials', { email: normalizedEmail, ip: req.ip });
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Invalid email or password' });
  }

  if (isPasswordExpired(user)) {
    user.mustChangePassword = true;
  }

  await clearFailedLogin(user);
  const session = await createSession(user, req);
  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken(user, session.sessionId);
  const payload = await userWithPermissions(user);
  payload.sessionId = session.sessionId;
  payload.concurrentSessions = true;

  recordActivity({
    module: AUTH_MODULE,
    entityId: user._id,
    entityLabel: user.email,
    action: 'login_success',
    description: `User logged in: ${user.email}`,
    user: { email: user.email, role: user.role, _id: user._id },
    req,
    meta: { sessionId: session.sessionId }
  });

  log.info('User logged in successfully', { email: user.email, role: user.role, ip: req.ip });
  res.json({ token, user: payload });
});

exports.logout = asyncHandler(async (req, res) => {
  if (req.sessionId) {
    await revokeSession(req.sessionId, 'logout');
  }
  recordActivity({
    module: AUTH_MODULE,
    entityId: req.user._id,
    entityLabel: req.user.email,
    action: 'logout',
    description: `User logged out: ${req.user.email}`,
    user: req.user,
    req
  });
  res.json({ loggedOut: true });
});

exports.me = asyncHandler(async (req, res) => {
  res.json(await userWithPermissions(req.user));
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id);
  if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'User not found' });

  if (!(await user.comparePassword(currentPassword || ''))) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: 'Current password is incorrect' });
  }

  assertValidPassword(newPassword);
  await user.setPassword(newPassword);
  user.mustChangePassword = false;
  user.isTemporaryPassword = false;
  user.passwordExpiresAt = computePasswordExpiry();
  user.securityVersion = (user.securityVersion || 0) + 1;
  Object.assign(user, auditOnUpdate(req.user));
  await user.save();

  await revokeAllSessions(user._id);
  const session = await createSession(user, req);
  const token = signToken(user, session.sessionId);

  recordActivity({
    module: AUTH_MODULE,
    entityId: user._id,
    entityLabel: user.email,
    action: 'password_changed',
    description: `Password changed for ${user.email}`,
    user: req.user,
    req
  });

  res.json({ token, user: await userWithPermissions(user) });
});

exports.createUser = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    password,
    role,
    teacher,
    student,
    linkedStudent,
    linkedStudents,
    useTemporaryPassword
  } = req.body;

  if (role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Only Super Admin can create Super Admin accounts' });
  }

  await assertAssignableRole(role);

  const initialPassword = useTemporaryPassword ? generateTemporaryPassword() : password;
  if (!initialPassword) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Password is required' });
  }
  if (!useTemporaryPassword) assertValidPassword(initialPassword);

  const userData = {
    name,
    email,
    role,
    passwordHash: 'pending',
    mustChangePassword: !!useTemporaryPassword,
    isTemporaryPassword: !!useTemporaryPassword,
    passwordExpiresAt: computePasswordExpiry()
  };
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
  await user.setPassword(initialPassword);
  await user.save();
  log.info('New user account created', { email: user.email, role: user.role, createdBy: req.user?.email });

  logEntityCreate({
    module: MODULES.USERS,
    entityId: user._id,
    entityLabel: user.email,
    action: ACTIONS.ROLE_ASSIGNMENT,
    description: `User account created with role ${user.role}: ${user.email}`,
    user: req.user,
    req,
    meta: { role: user.role, temporaryPassword: !!useTemporaryPassword }
  });

  const response = await userWithPermissions(user);
  if (useTemporaryPassword) response.temporaryPassword = initialPassword;
  res.status(HTTP_STATUS.CREATED).json(response);
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
    await assertAssignableRole(role);
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
    user: req.user,
    req
  });

  if (role && role !== previousRole) {
    logEntityUpdate({
      module: MODULES.USERS,
      entityId: user._id,
      entityLabel: user.email,
      action: ACTIONS.ROLE_ASSIGNMENT,
      description: `User role changed from ${previousRole} to ${user.role}`,
      user: req.user,
      req,
      previousValue: previousRole,
      updatedValue: user.role
    });
  }

  if (isActive !== undefined && isActive !== previousActive) {
    logStatusChange({
      module: MODULES.USERS,
      entityId: user._id,
      entityLabel: user.email,
      previousStatus: previousActive ? 'active' : 'inactive',
      newStatus: user.isActive ? 'active' : 'inactive',
      user: req.user,
      req,
      remarks: 'User account status updated'
    });
  }

  res.json(await userWithPermissions(user));
});

exports.issueTemporaryPassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'User not found' });

  const tempPassword = generateTemporaryPassword();
  await user.setPassword(tempPassword);
  user.mustChangePassword = true;
  user.isTemporaryPassword = true;
  user.passwordExpiresAt = computePasswordExpiry();
  user.securityVersion = (user.securityVersion || 0) + 1;
  Object.assign(user, auditOnUpdate(req.user));
  await user.save();
  await revokeAllSessions(user._id);

  recordActivity({
    module: MODULES.USERS,
    entityId: user._id,
    entityLabel: user.email,
    action: 'temporary_password_issued',
    description: `Temporary password issued for ${user.email}`,
    user: req.user,
    req
  });

  res.json({ temporaryPassword: tempPassword, user: await userWithPermissions(user) });
});

exports.unlockAccount = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'User not found' });

  const previousLockedUntil = user.lockedUntil;
  const previousAttempts = user.failedLoginAttempts;
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  Object.assign(user, auditOnUpdate(req.user));
  await user.save();

  recordActivity({
    module: MODULES.USERS,
    entityId: user._id,
    entityLabel: user.email,
    action: 'account_unlocked',
    description: `Account unlocked for ${user.email}`,
    user: req.user,
    req,
    previousValue: { lockedUntil: previousLockedUntil, failedLoginAttempts: previousAttempts },
    updatedValue: { lockedUntil: null, failedLoginAttempts: 0 }
  });

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
  await revokeAllSessions(user._id);

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
  await revokeAllSessions(user._id);
  await User.deleteOne({ _id: user._id });
  log.info('User permanently deleted', { userId: user._id, by: req.user.email });
  res.json({ deleted: true });
});

exports.listRoles = asyncHandler(async (_req, res) => {
  const roles = await Role.find().sort({ isSystem: -1, name: 1 }).lean();
  res.json(roles.map((role) => ({
    slug: role.slug,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem
  })));
});
