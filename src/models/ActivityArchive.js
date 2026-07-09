const mongoose = require('mongoose');

const activityArchiveSchema = new mongoose.Schema(
  {
    module: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    entityLabel: { type: String, trim: true },
    action: { type: String, required: true, index: true },
    description: { type: String, required: true },
    performedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      email: String,
      name: String,
      role: String
    },
    performedAt: { type: Date, required: true, index: true },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    previousValue: mongoose.Schema.Types.Mixed,
    updatedValue: mongoose.Schema.Types.Mixed,
    remarks: { type: String, trim: true },
    archivedAt: { type: Date, default: Date.now, index: true },
    meta: mongoose.Schema.Types.Mixed,
    sourceId: { type: mongoose.Schema.Types.ObjectId, index: true }
  },
  { timestamps: false, versionKey: false }
);

activityArchiveSchema.index({ performedAt: -1 });
activityArchiveSchema.index({ description: 'text', entityLabel: 'text' });

module.exports = mongoose.model('ActivityArchive', activityArchiveSchema);
