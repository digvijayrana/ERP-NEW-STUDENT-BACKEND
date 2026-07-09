const mongoose = require('mongoose');

const userSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    userAgent: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    lastActiveAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    isActive: { type: Boolean, default: true },
    terminatedReason: { type: String, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserSession', userSessionSchema);
