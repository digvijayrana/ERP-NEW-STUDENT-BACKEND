const mongoose = require('mongoose');

const configurationVersionSchema = new mongoose.Schema(
  {
    section: { type: String, required: true, trim: true },
    version: { type: Number, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    changeSummary: { type: String, trim: true },
    effectiveFrom: { type: Date, default: Date.now, index: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

configurationVersionSchema.index({ section: 1, version: -1 });
configurationVersionSchema.index({ section: 1, effectiveFrom: -1 });

module.exports = mongoose.model('ConfigurationVersion', configurationVersionSchema);
