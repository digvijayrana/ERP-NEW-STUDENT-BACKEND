const mongoose = require('mongoose');

const schoolTenantSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]+$/, 'Invalid tenant slug']
    },
    name: { type: String, required: true, trim: true },
    dbName: { type: String, required: true, trim: true },
    mongoUri: { type: String, trim: true },
    logoUrl: { type: String, trim: true, default: '' },
    website: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      index: true
    },
    notes: { type: String, trim: true }
  },
  { timestamps: true }
);

schoolTenantSchema.index({ slug: 1 }, { unique: true });

module.exports = {
  schema: schoolTenantSchema,
  MODEL_NAME: 'SchoolTenant'
};
