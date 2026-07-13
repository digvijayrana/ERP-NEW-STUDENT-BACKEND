const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');
const { softDeleteFieldSchema, applySoftDeleteMiddleware } = require('../utils/softDeleteFields');

// A driver salary payment record. Presence of a (vehicle, month, year) record marks
// that month's salary as paid; absence means it is still pending/unpaid.
const driverSalaryPaymentSchema = new mongoose.Schema(
  {
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    driverName: { type: String, trim: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    amount: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: ['cash', 'bank', 'upi', 'cheque'], default: 'cash' },
    referenceNumber: { type: String, trim: true },
    paidOn: { type: Date, default: Date.now },
    notes: { type: String, trim: true },
    status: { type: String, enum: ['paid'], default: 'paid' },
    ...softDeleteFieldSchema,
    ...auditFieldSchema
  },
  { timestamps: true }
);

applySoftDeleteMiddleware(driverSalaryPaymentSchema);

driverSalaryPaymentSchema.index({ vehicle: 1, year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('DriverSalaryPayment', driverSalaryPaymentSchema);
