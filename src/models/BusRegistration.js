const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');

const busRegistrationSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'BusRoute', required: true },
    stopName: { type: String, required: true, trim: true },
    stopSequence: { type: Number, required: true, min: 1 },
    monthlyFee: { type: Number, required: true, min: 0 },
    busService: { type: Boolean, default: true },
    serviceStartDate: { type: Date, required: true },
    serviceEndDate: { type: Date },
    feeEffectiveFrom: { type: Date },
    historicalLocked: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...auditFieldSchema
  },
  { timestamps: true }
);

busRegistrationSchema.index(
  { student: 1, academicYear: 1 },
  { unique: true, partialFilterExpression: { status: 'active', busService: true } }
);
busRegistrationSchema.index({ route: 1, status: 1 });
busRegistrationSchema.index({ academicYear: 1, status: 1 });

module.exports = mongoose.model('BusRegistration', busRegistrationSchema);
