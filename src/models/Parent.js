const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');
const { softDeleteFieldSchema, applySoftDeleteMiddleware } = require('../utils/softDeleteFields');

/**
 * Normalized Parent/Guardian entity. One Parent record can be linked to many
 * Students (children) via `children`, so parent details live in a single place
 * instead of being duplicated across every child's `guardians` array.
 *
 * Backward compatibility: Student.guardians is retained as a denormalized
 * snapshot for existing read paths; Parent is the normalized source of truth
 * going forward and each Student additionally references its Parent via
 * Student.parent.
 */
const parentSchema = new mongoose.Schema(
  {
    // Central auth account for the parent portal (unique, one User per Parent).
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
    name: { type: String, required: true, trim: true },
    relation: { type: String, trim: true },
    phone: {
      type: String,
      trim: true,
      match: [/^\d{10}$/, 'Phone number must be exactly 10 digits']
    },
    email: { type: String, trim: true, lowercase: true },
    occupation: { type: String, trim: true },
    aadhaarNumber: {
      type: String,
      trim: true,
      match: [/^\d{12}$/, 'Aadhaar number must be exactly 12 digits']
    },
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String
    },
    children: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    ...softDeleteFieldSchema,
    ...auditFieldSchema
  },
  { timestamps: true }
);

applySoftDeleteMiddleware(parentSchema);

// Fast lookup / de-duplication of parents by contact details.
parentSchema.index({ phone: 1 });
parentSchema.index({ email: 1 });

parentSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Parent', parentSchema);
