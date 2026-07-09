const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema(
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
    performedAt: { type: Date, default: Date.now, index: true },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    previousValue: mongoose.Schema.Types.Mixed,
    updatedValue: mongoose.Schema.Types.Mixed,
    remarks: { type: String, trim: true },
    meta: mongoose.Schema.Types.Mixed
  },
  { timestamps: false, versionKey: false }
);

activitySchema.index({ performedAt: -1 });

const IMMUTABLE_MSG = 'Activity records are immutable and cannot be modified or deleted';

['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'].forEach((method) => {
  activitySchema.pre(method, function blockMutation() {
    throw new Error(IMMUTABLE_MSG);
  });
});

module.exports = mongoose.model('Activity', activitySchema);
