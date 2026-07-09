const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { PASSWORD } = require('../constants');
const { auditFieldSchema } = require('../utils/auditFields');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, trim: true, index: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    linkedStudent: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    linkedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: Date,
    mustChangePassword: { type: Boolean, default: false },
    isTemporaryPassword: { type: Boolean, default: false },
    passwordChangedAt: Date,
    passwordExpiresAt: Date,
    securityVersion: { type: Number, default: 0 },
    ...auditFieldSchema
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function setPassword(password) {
  this.passwordHash = await bcrypt.hash(password, PASSWORD.BCRYPT_ROUNDS);
  this.passwordChangedAt = new Date();
};

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const linked = this.linkedStudents?.length
    ? this.linkedStudents
    : this.linkedStudent ? [this.linkedStudent] : [];
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    teacher: this.teacher,
    student: this.student,
    linkedStudent: this.linkedStudent,
    linkedStudents: linked,
    isActive: this.isActive,
    mustChangePassword: this.mustChangePassword,
    isTemporaryPassword: this.isTemporaryPassword,
    passwordExpiresAt: this.passwordExpiresAt,
    lockedUntil: this.lockedUntil
  };
};

module.exports = mongoose.model('User', userSchema);
