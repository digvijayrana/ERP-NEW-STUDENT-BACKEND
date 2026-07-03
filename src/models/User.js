const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'teacher', 'student', 'parent'], required: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    linkedStudent: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function setPassword(password) {
  this.passwordHash = await bcrypt.hash(password, 12);
};

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    teacher: this.teacher,
    student: this.student,
    linkedStudent: this.linkedStudent,
    isActive: this.isActive
  };
};

module.exports = mongoose.model('User', userSchema);
