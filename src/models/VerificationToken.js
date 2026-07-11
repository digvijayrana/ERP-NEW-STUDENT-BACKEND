const crypto = require('crypto');
const mongoose = require('mongoose');

/**
 * Unified single-use token store for email verification and password reset flows.
 * The raw token is never persisted - only its SHA-256 hash - so a database leak
 * cannot be used to hijack verification/reset links.
 */
const verificationTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['email_verification', 'password_reset'],
      required: true
    },
    // OTP flows record verification attempts so we can lock brute-force guessing.
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
    createdByIp: { type: String }
  },
  { timestamps: true }
);

// Auto-purge tokens once they expire (MongoDB TTL monitor).
verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

verificationTokenSchema.statics.hashToken = function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
};

/**
 * Issues a new token for a user, invalidating any previous unused tokens of the
 * same type so only one link is ever live at a time.
 * @returns {{ rawToken: string, record: object }}
 */
verificationTokenSchema.statics.issue = async function issue({ userId, type, ttlMs, ip }) {
  await this.updateMany(
    { user: userId, type, usedAt: { $exists: false } },
    { usedAt: new Date() }
  );
  const rawToken = crypto.randomBytes(32).toString('hex');
  const record = await this.create({
    user: userId,
    tokenHash: this.hashToken(rawToken),
    type,
    expiresAt: new Date(Date.now() + ttlMs),
    createdByIp: ip
  });
  return { rawToken, record };
};

/**
 * Looks up a live (unused, unexpired) token by its raw value.
 */
verificationTokenSchema.statics.consume = async function consume({ rawToken, type }) {
  const tokenHash = this.hashToken(rawToken);
  const record = await this.findOne({
    tokenHash,
    type,
    usedAt: { $exists: false },
    expiresAt: { $gt: new Date() }
  });
  if (!record) return null;
  record.usedAt = new Date();
  await record.save();
  return record;
};

/**
 * Issues a numeric OTP code for a user (used for password reset by email).
 * Invalidates previous unused OTPs of the same type first.
 * @returns {{ otp: string, record: object }}
 */
verificationTokenSchema.statics.issueOtp = async function issueOtp({ userId, type, ttlMs, ip, digits = 6 }) {
  await this.updateMany(
    { user: userId, type, usedAt: { $exists: false } },
    { usedAt: new Date() }
  );
  const min = 10 ** (digits - 1);
  const otp = String(crypto.randomInt(min, 10 ** digits));
  const record = await this.create({
    user: userId,
    tokenHash: this.hashToken(otp),
    type,
    expiresAt: new Date(Date.now() + ttlMs),
    createdByIp: ip
  });
  return { otp, record };
};

/**
 * Verifies an OTP for a specific user. OTPs are scoped per-user because short
 * numeric codes are not globally unique. Enforces a max attempt count.
 * @returns {{ ok: true, record } | { ok: false, reason: 'expired'|'invalid'|'locked' }}
 */
verificationTokenSchema.statics.verifyOtp = async function verifyOtp({ userId, otp, type, maxAttempts = 5, consume = true }) {
  const record = await this.findOne({
    user: userId,
    type,
    usedAt: { $exists: false },
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });

  if (!record) return { ok: false, reason: 'expired' };

  if ((record.attempts || 0) >= maxAttempts) {
    record.usedAt = new Date();
    await record.save();
    return { ok: false, reason: 'locked' };
  }

  const matches = record.tokenHash === this.hashToken(String(otp || ''));
  if (!matches) {
    record.attempts = (record.attempts || 0) + 1;
    await record.save();
    const remaining = Math.max(0, maxAttempts - record.attempts);
    return { ok: false, reason: 'invalid', remaining };
  }

  if (consume) {
    record.usedAt = new Date();
    await record.save();
  }
  return { ok: true, record };
};

module.exports = mongoose.model('VerificationToken', verificationTokenSchema);
