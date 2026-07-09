const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');

const backgroundJobSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['report_export', 'pdf_generation', 'csv_export', 'email_notification', 'activity_archive', 'bulk_notification', 'bulk_export'],
      required: true
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    payload: mongoose.Schema.Types.Mixed,
    result: mongoose.Schema.Types.Mixed,
    errorMessage: String,
    startedAt: Date,
    completedAt: Date,
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ...auditFieldSchema
  },
  { timestamps: true }
);

backgroundJobSchema.index({ createdAt: -1 });
backgroundJobSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model('BackgroundJob', backgroundJobSchema);
