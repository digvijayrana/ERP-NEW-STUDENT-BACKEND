const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');

const promotionStudentSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    included: { type: Boolean, default: true },
    outcome: { type: String, enum: ['promoted', 'excluded', 'detained'], default: 'promoted' },
    rollNumber: String,
    eligible: { type: Boolean, default: true },
    ineligibleReason: String,
    warnings: [{ code: String, message: String }],
    current: {
      academicYear: mongoose.Schema.Types.ObjectId,
      classRoom: mongoose.Schema.Types.ObjectId,
      rollNumber: String,
      monthlyFee: Number,
      classLabel: String,
      yearLabel: String
    },
    proposed: {
      academicYear: mongoose.Schema.Types.ObjectId,
      classRoom: mongoose.Schema.Types.ObjectId,
      rollNumber: String,
      monthlyFee: Number,
      classLabel: String,
      yearLabel: String
    },
    busAssignmentLabel: String,
    rollback: {
      previousEnrollmentId: mongoose.Schema.Types.ObjectId,
      previousStatus: String,
      previousToDate: Date,
      newEnrollmentId: mongoose.Schema.Types.ObjectId
    }
  },
  { _id: true }
);

const promotionBatchSchema = new mongoose.Schema(
  {
    fromAcademicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    toAcademicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    fromClassRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    toClassRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    rollMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    status: { type: String, enum: ['draft', 'finalized', 'rolled_back'], default: 'draft' },
    locked: { type: Boolean, default: false },
    students: [promotionStudentSchema],
    promotedCount: { type: Number, default: 0 },
    excludedCount: { type: Number, default: 0 },
    warningsAcknowledged: { type: Boolean, default: false },
    finalizedAt: Date,
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rolledBackAt: Date,
    rolledBackBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ...auditFieldSchema
  },
  { timestamps: true }
);

promotionBatchSchema.index({ fromAcademicYear: 1, toAcademicYear: 1, status: 1 });
promotionBatchSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PromotionBatch', promotionBatchSchema);
