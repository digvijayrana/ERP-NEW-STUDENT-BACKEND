const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');
const { softDeleteFieldSchema, applySoftDeleteMiddleware } = require('../utils/softDeleteFields');

const salaryHistorySchema = new mongoose.Schema(
  {
    basicSalary: { type: Number, required: true, min: 0 },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: Date,
    recordedAt: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { _id: true }
);

const teacherSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true, unique: true, trim: true },
    // Central auth account auto-created for the teacher on registration.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    firstName: { type: String, required: true, trim: true },
    middleName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'Phone number must be exactly 10 digits']
    },
    email: { type: String, trim: true, lowercase: true },
    aadhaarNumber: {
      type: String,
      trim: true,
      match: [/^\d{12}$/, 'Aadhaar number must be exactly 12 digits']
    },
    qualification: { type: String, trim: true },
    subjects: [{ type: String, trim: true }],
    joiningDate: { type: Date, default: Date.now },
    baseSalary: { type: Number, required: true, min: 0 },
    /** Paid leave days allowed per month before salary deduction. */
    monthlyAllowedLeaves: { type: Number, default: 0, min: 0 },
    salaryHistory: [salaryHistorySchema],
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String
    },
    experience: [{
      instituteName: { type: String, trim: true },
      designation: { type: String, trim: true },
      fromDate: Date,
      toDate: Date,
      description: { type: String, trim: true },
      document: { url: String, originalName: String, uploadedAt: Date }
    }],
    education: [{
      instituteName: { type: String, trim: true },
      degree: { type: String, trim: true },
      fieldOfStudy: { type: String, trim: true },
      fromDate: Date,
      toDate: Date,
      grade: { type: String, trim: true },
      document: { url: String, originalName: String, uploadedAt: Date }
    }],
    documents: {
      photo: { url: String, storageKey: String, originalName: String, uploadedAt: Date },
      idProof: { url: String, storageKey: String, originalName: String, uploadedAt: Date, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }, rejectReason: String },
      resume: { url: String, storageKey: String, originalName: String, uploadedAt: Date, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }, rejectReason: String },
      certificates: [{ url: String, storageKey: String, originalName: String, uploadedAt: Date, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }, rejectReason: String }]
    },
    ...softDeleteFieldSchema,
    ...auditFieldSchema
  },
  { timestamps: true }
);

applySoftDeleteMiddleware(teacherSchema);

teacherSchema.index({ phone: 1 }, { unique: true, sparse: true });
teacherSchema.index({ email: 1 }, { unique: true, sparse: true });
teacherSchema.index({ aadhaarNumber: 1 }, { unique: true, sparse: true });

teacherSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.middleName, this.lastName].filter(Boolean).join(' ');
});

teacherSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Teacher', teacherSchema);
