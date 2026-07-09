const crypto = require('crypto');
const UserSession = require('../models/UserSession');
const securityConfig = require('../config/security.config');
const { HTTP_STATUS } = require('../constants');
const { createLogger } = require('../utils/logger');

const log = createLogger('security');

function validatePassword(password) {
  const policy = securityConfig.password;
  const errors = [];
  const value = String(password || '');

  if (value.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(value)) {
    errors.push('Password must include an uppercase letter');
  }
  if (policy.requireLowercase && !/[a-z]/.test(value)) {
    errors.push('Password must include a lowercase letter');
  }
  if (policy.requireNumber && !/\d/.test(value)) {
    errors.push('Password must include a number');
  }
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(value)) {
    errors.push('Password must include a special character');
  }

  return errors;
}

function assertValidPassword(password) {
  const errors = validatePassword(password);
  if (errors.length) {
    const error = new Error(errors.join('. '));
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.details = errors;
    throw error;
  }
}

function isPasswordExpired(user) {
  if (!user.passwordExpiresAt) return false;
  return new Date(user.passwordExpiresAt) < new Date();
}

function computePasswordExpiry() {
  const days = securityConfig.password.expiryDays;
  if (!days) return null;
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  return expires;
}

function isAccountLocked(user) {
  if (!user.lockedUntil) return false;
  if (new Date(user.lockedUntil) > new Date()) return true;
  user.lockedUntil = undefined;
  return false;
}

async function recordFailedLogin(user, req) {
  user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
  const max = securityConfig.lockout.maxFailedAttempts;
  const { recordActivity } = require('./activityLog.service');
  const { MODULES, ACTIONS } = require('../constants/activityActions');

  if (user.failedLoginAttempts >= max) {
    const lockedUntil = new Date();
    lockedUntil.setMinutes(lockedUntil.getMinutes() + securityConfig.lockout.lockDurationMinutes);
    user.lockedUntil = lockedUntil;
    log.warn('Account locked after failed attempts', { email: user.email, attempts: user.failedLoginAttempts });
    recordActivity({
      module: MODULES.USERS,
      entityId: user._id,
      entityLabel: user.email,
      action: ACTIONS.ACCOUNT_LOCKED,
      description: `Account locked after ${user.failedLoginAttempts} failed login attempts`,
      user: { email: user.email, role: user.role },
      req,
      meta: { lockedUntil, failedLoginAttempts: user.failedLoginAttempts }
    });
  } else {
    recordActivity({
      module: 'auth',
      entityId: user._id,
      entityLabel: user.email,
      action: ACTIONS.LOGIN_FAILED,
      description: `Failed login attempt for ${user.email}`,
      user: { email: user.email, role: user.role },
      req,
      meta: { failedLoginAttempts: user.failedLoginAttempts }
    });
  }
  await user.save();
}

async function clearFailedLogin(user) {
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  await user.save();
}

function newSessionId() {
  return crypto.randomUUID();
}

function sessionExpiryDate() {
  const minutes = securityConfig.session.idleTimeoutMinutes;
  const expires = new Date();
  expires.setMinutes(expires.getMinutes() + minutes);
  return expires;
}

async function createSession(user, req = {}) {
  const sessionId = newSessionId();
  const expiresAt = sessionExpiryDate();

  const activeSessions = await UserSession.find({
    user: user._id,
    isActive: true,
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: 1 });

  const policy = securityConfig.session.multiLoginPolicy;
  const max = securityConfig.session.maxConcurrentSessions;

  if (activeSessions.length >= max) {
    if (policy === 'block_new') {
      const error = new Error('Maximum concurrent sessions reached. Sign out from another device first.');
      error.status = HTTP_STATUS.FORBIDDEN;
      error.code = 'MAX_SESSIONS';
      throw error;
    }
    if (policy === 'terminate_oldest') {
      const toRevoke = activeSessions.slice(0, activeSessions.length - max + 1);
      for (const session of toRevoke) {
        session.isActive = false;
        session.terminatedReason = 'superseded_by_new_login';
        await session.save();
      }
    }
  }

  const session = await UserSession.create({
    user: user._id,
    sessionId,
    userAgent: req.headers?.['user-agent'] || '',
    ipAddress: req.ip || req.connection?.remoteAddress || '',
    lastActiveAt: new Date(),
    expiresAt,
    isActive: true
  });

  return session;
}

async function validateSession(sessionId, userId) {
  if (!sessionId) return null;
  const session = await UserSession.findOne({
    sessionId,
    user: userId,
    isActive: true,
    expiresAt: { $gt: new Date() }
  });
  if (!session) return null;

  session.lastActiveAt = new Date();
  session.expiresAt = sessionExpiryDate();
  await session.save();
  return session;
}

async function revokeSession(sessionId, reason = 'logout') {
  if (!sessionId) return;
  await UserSession.updateOne(
    { sessionId },
    { isActive: false, terminatedReason: reason }
  );
}

async function revokeAllSessions(userId, exceptSessionId) {
  const filter = { user: userId, isActive: true };
  if (exceptSessionId) filter.sessionId = { $ne: exceptSessionId };
  await UserSession.updateMany(filter, { isActive: false, terminatedReason: 'admin_revoke' });
}

function getSecurityPolicy() {
  return {
    password: {
      minLength: securityConfig.password.minLength,
      requireUppercase: securityConfig.password.requireUppercase,
      requireLowercase: securityConfig.password.requireLowercase,
      requireNumber: securityConfig.password.requireNumber,
      requireSpecial: securityConfig.password.requireSpecial,
      expiryDays: securityConfig.password.expiryDays
    },
    lockout: {
      maxFailedAttempts: securityConfig.lockout.maxFailedAttempts,
      lockDurationMinutes: securityConfig.lockout.lockDurationMinutes
    },
    session: {
      idleTimeoutMinutes: securityConfig.session.idleTimeoutMinutes,
      maxConcurrentSessions: securityConfig.session.maxConcurrentSessions,
      multiLoginPolicy: securityConfig.session.multiLoginPolicy
    }
  };
}

module.exports = {
  validatePassword,
  assertValidPassword,
  isPasswordExpired,
  computePasswordExpiry,
  isAccountLocked,
  recordFailedLogin,
  clearFailedLogin,
  createSession,
  validateSession,
  revokeSession,
  revokeAllSessions,
  getSecurityPolicy,
  newSessionId
};
