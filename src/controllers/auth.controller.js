const crypto = require('crypto');
const User = require('../models/User');
const Role = require('../models/Role');
const VerificationToken = require('../models/VerificationToken');
const asyncHandler = require('../middleware/asyncHandler');
const { signToken } = require('../services/token.service');
const { getPermissionsForRole, assertAssignableRole } = require('../services/permission.service');
const { issueEmailVerification } = require('../services/accountProvisioning.service');
const { sendPasswordResetOtp } = require('../services/email.service');
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
const PASSWORD_RESET_TTL_MS = Number(process.env.PASSWORD_RESET_OTP_TTL_MS) || 10 * 60 * 1000;
const PASSWORD_RESET_OTP_MAX_ATTEMPTS = Number(process.env.PASSWORD_RESET_OTP_MAX_ATTEMPTS) || 5;

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
  const { email, username, identifier, password } = req.body;
  // Accept email OR username as the login identifier (students log in by username).
  const loginId = String(identifier || email || username || '').toLowerCase().trim();
  const user = await User.findOne({ $or: [{ email: loginId }, { username: loginId }] });

  if (!user || !user.isActive) {
    log.warn('Login failed - invalid credentials', { identifier: loginId, ip: req.ip });
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
    const status = await recordFailedLogin(user, req);
    log.warn('Login failed - invalid credentials', { identifier: loginId, ip: req.ip });
    if (status.locked) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        message: 'Account temporarily locked due to too many failed attempts. Try again later or reset your password.',
        lockedUntil: status.lockedUntil
      });
    }
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      message: status.remaining > 0
        ? `Invalid email or password. ${status.remaining} attempt(s) remaining before your account is locked.`
        : 'Invalid email or password.',
      remainingAttempts: status.remaining
    });
  }

  // Teachers & parents must verify their email before first login. Pre-existing
  // accounts have emailVerificationRequired=false and are unaffected.
  if (user.emailVerificationRequired && !user.isEmailVerified) {
    recordActivity({
      module: AUTH_MODULE,
      entityId: user._id,
      entityLabel: user.email,
      action: 'login_blocked_unverified',
      description: `Login blocked - email not verified for ${user.email}`,
      user: { email: user.email, role: user.role },
      req
    });
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      message: 'Please verify your email address before signing in. Check your inbox for the verification link.',
      code: 'EMAIL_NOT_VERIFIED'
    });
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

// Verify email (teachers & parents) and optionally set the initial password.
exports.verifyEmail = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Verification token is required' });

  const record = await VerificationToken.consume({ rawToken: token, type: 'email_verification' });
  if (!record) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'This verification link is invalid or has expired' });
  }

  const user = await User.findById(record.user);
  if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Account not found' });

  user.isEmailVerified = true;
  user.emailVerifiedAt = new Date();

  if (password) {
    assertValidPassword(password);
    await user.setPassword(password);
    user.mustChangePassword = false;
    user.isTemporaryPassword = false;
    user.passwordExpiresAt = computePasswordExpiry();
    user.securityVersion = (user.securityVersion || 0) + 1;
  }
  await user.save();

  recordActivity({
    module: AUTH_MODULE,
    entityId: user._id,
    entityLabel: user.email,
    action: 'email_verified',
    description: `Email verified for ${user.email}`,
    user: { email: user.email, role: user.role },
    req
  });

  res.json({ verified: true, passwordSet: !!password, email: user.email });
});

// Re-send a verification email (generic response to avoid account enumeration).
exports.resendVerification = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const user = email ? await User.findOne({ email }) : null;
  if (user && user.isActive && user.emailVerificationRequired && !user.isEmailVerified) {
    await issueEmailVerification({ user, req });
  }
  res.json({ message: 'If an unverified account exists for that email, a verification link has been sent.' });
});

// Forgot password (any role) - emails a one-time code (OTP) to the registered email.
exports.forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const user = email ? await User.findOne({ email }) : null;

  if (!user) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Email Id is not found' });
  }

  const expiryMinutes = Math.round(PASSWORD_RESET_TTL_MS / 60000);
  // Generic response to avoid revealing whether an email is registered.
  const response = {
    message: 'If an account exists for that email, a one-time code has been sent.',
    expiresInMinutes: expiryMinutes
  };

  if (user && user.isActive) {
    const { otp } = await VerificationToken.issueOtp({
      userId: user._id,
      type: 'password_reset',
      ttlMs: PASSWORD_RESET_TTL_MS,
      ip: req.ip
    });

    console.log('Otp',otp)
    const result = await sendPasswordResetOtp({ to: user.email, name: user.name, otp, expiryMinutes });
    response.emailSent = !!result.delivered;

    recordActivity({
      module: AUTH_MODULE,
      entityId: user._id,
      entityLabel: user.email,
      action: 'password_reset_requested',
      description: `Password reset code requested for ${user.email}`,
      user: { email: user.email, role: user.role },
      req,
      meta: { emailDelivered: !!result.delivered }
    });

    // Fallback: if the email could not actually be delivered (SMTP not
    // configured or send failed) surface the OTP in the response so the flow
    // still works outside production. Never leak the code in production.
    if (!result.delivered && process.env.NODE_ENV !== 'production') {
      response.devOtp = otp;
    }
  }

  res.json(response);
});

// Optional pre-check: verify the OTP without consuming it (drives the UI step).
exports.verifyResetOtp = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const otp = String(req.body.otp || '').trim();
  const user = email ? await User.findOne({ email }) : null;
  if (!user) return res.status(HTTP_STATUS.BAD_REQUEST).json({ valid: false, message: 'Invalid or expired code' });

  const result = await VerificationToken.verifyOtp({
    userId: user._id,
    otp,
    type: 'password_reset',
    maxAttempts: PASSWORD_RESET_OTP_MAX_ATTEMPTS,
    consume: false
  });

  if (!result.ok) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ valid: false, ...otpErrorBody(result) });
  }
  res.json({ valid: true });
});

// Reset password using the emailed OTP.
exports.resetPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const otp = String(req.body.otp || '').trim();
  const { password } = req.body;
  if (!email || !otp || !password) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Email, code, and new password are required' });
  }

  const user = await User.findOne({ email });
  // Validate the password format before checking the OTP so obviously invalid
  // requests fail early; still returns a generic error for unknown emails.
  assertValidPassword(password);
  if (!user) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Invalid or expired code' });

  const result = await VerificationToken.verifyOtp({
    userId: user._id,
    otp,
    type: 'password_reset',
    maxAttempts: PASSWORD_RESET_OTP_MAX_ATTEMPTS,
    consume: true
  });
  if (!result.ok) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(otpErrorBody(result));
  }

  await user.setPassword(password);
  user.mustChangePassword = false;
  user.isTemporaryPassword = false;
  user.passwordExpiresAt = computePasswordExpiry();
  user.securityVersion = (user.securityVersion || 0) + 1;
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  await user.save();
  await revokeAllSessions(user._id);

  recordActivity({
    module: AUTH_MODULE,
    entityId: user._id,
    entityLabel: user.email,
    action: 'password_reset_completed',
    description: `Password reset completed for ${user.email}`,
    user: { email: user.email, role: user.role },
    req
  });

  res.json({ reset: true });
});

function otpErrorBody(result) {
  if (result.reason === 'expired') return { message: 'Your code has expired. Please request a new one.', code: 'OTP_EXPIRED' };
  if (result.reason === 'locked') return { message: 'Too many incorrect attempts. Please request a new code.', code: 'OTP_LOCKED' };
  const suffix = typeof result.remaining === 'number' ? ` ${result.remaining} attempt(s) left.` : '';
  return { message: `Incorrect code.${suffix}`, code: 'OTP_INVALID' };
}

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
