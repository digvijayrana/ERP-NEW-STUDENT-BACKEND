/**
 * Centralized security policy configuration.
 * Supports future enhancements such as MFA without code changes to consumers.
 */
module.exports = {
  password: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
    expiryDays: 90
  },
  lockout: {
    maxFailedAttempts: 5,
    lockDurationMinutes: 30
  },
  session: {
    idleTimeoutMinutes: 30,
    maxConcurrentSessions: 3,
    /** warn: allow but flag; block_new: reject login; terminate_oldest: revoke oldest session */
    multiLoginPolicy: 'terminate_oldest'
  }
};
