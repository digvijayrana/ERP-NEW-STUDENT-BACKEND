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
