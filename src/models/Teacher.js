const mongoose = require('mongoose');

const teacherSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true, unique: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'Phone number must be exactly 10 digits']
    },
    email: { type: String, trim: true, lowercase: true },
    qualification: { type: String, trim: true },
    joiningDate: { type: Date, default: Date.now },
    baseSalary: { type: Number, required: true, min: 0 },
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
      idProof: { url: String, originalName: String, uploadedAt: Date, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }, rejectReason: String },
      resume: { url: String, originalName: String, uploadedAt: Date, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }, rejectReason: String },
      certificates: [{ url: String, originalName: String, uploadedAt: Date, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }, rejectReason: String }]
    }
  },
  { timestamps: true }
);

teacherSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

teacherSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Teacher', teacherSchema);
