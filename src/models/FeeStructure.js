const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');

const FEE_FREQUENCIES = ['one_time', 'monthly', 'quarterly', 'half_yearly', 'yearly'];

const feeComponentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0, default: 0 },
    frequency: { type: String, enum: FEE_FREQUENCIES, default: 'monthly' },
    // Applies only to brand-new admissions (e.g. admission fee) — billed once, ever.
    newAdmissionOnly: { type: Boolean, default: false }
  },
  { _id: false }
);

const feeStructureSchema = new mongoose.Schema(
  {
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    // Fee structures are defined per class NAME (e.g. "V") so a single structure
    // applies to every section of that class. `classRoom` is retained only for
    // legacy/section-specific structures created before this change.
    className: { type: String, trim: true },
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom' },
    components: { type: [feeComponentSchema], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...auditFieldSchema
  },
  { timestamps: true }
);

// One structure per class-name per year (primary keying).
feeStructureSchema.index(
  { academicYear: 1, className: 1 },
  { unique: true, partialFilterExpression: { className: { $type: 'string' } } }
);
// Legacy per-section structures remain uniquely keyed when a classRoom is set.
feeStructureSchema.index(
  { academicYear: 1, classRoom: 1 },
  { unique: true, partialFilterExpression: { classRoom: { $type: 'objectId' } } }
);

feeStructureSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('FeeStructure', feeStructureSchema);
module.exports.FEE_FREQUENCIES = FEE_FREQUENCIES;
