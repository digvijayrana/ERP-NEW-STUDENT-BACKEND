const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');
const { softDeleteFieldSchema, applySoftDeleteMiddleware } = require('../utils/softDeleteFields');

const payrollSchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    month: { type: Number, min: 1, max: 12, required: true },
    year: { type: Number, required: true },
    basicSalary: { type: Number, required: true, min: 0 },
    allowances: { type: Number, default: 0, min: 0 },
    deductions: { type: Number, default: 0, min: 0 },
    /** Manual/other deductions excluding auto leave deduction. */
    otherDeductions: { type: Number, default: 0, min: 0 },
    leaveSummary: {
      allowedLeaves: { type: Number, default: 0, min: 0 },
      leavesTaken: { type: Number, default: 0, min: 0 },
      excessLeaves: { type: Number, default: 0, min: 0 },
      daysInMonth: { type: Number, default: 0, min: 0 },
      perDayRate: { type: Number, default: 0, min: 0 },
      leaveDeduction: { type: Number, default: 0, min: 0 }
    },
    salaryEffectiveSnapshot: { type: Number, min: 0 },
    paidAt: Date,
    paymentMode: { type: String, enum: ['cash', 'bank_transfer', 'upi', 'cheque'], default: 'bank_transfer' },
    status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
    locked: { type: Boolean, default: false },
    lockedAt: Date,
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    unlockedAt: Date,
    unlockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    remarks: String,
    ...softDeleteFieldSchema,
    ...auditFieldSchema
  },
  { timestamps: true }
);

applySoftDeleteMiddleware(payrollSchema);

payrollSchema.virtual('netSalary').get(function netSalary() {
  return this.basicSalary + this.allowances - this.deductions;
});

payrollSchema.index({ teacher: 1, month: 1, year: 1 }, { unique: true });
payrollSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Payroll', payrollSchema);
