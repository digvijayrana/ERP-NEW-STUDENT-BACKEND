const mongoose = require('mongoose');

const notificationDismissalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notificationKey: { type: String, required: true, trim: true },
    dismissedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

notificationDismissalSchema.index({ user: 1, notificationKey: 1 }, { unique: true });

module.exports = mongoose.model('NotificationDismissal', notificationDismissalSchema);
