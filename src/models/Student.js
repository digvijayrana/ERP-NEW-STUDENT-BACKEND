const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');

function emptyToUndefined(value) {
  return value === '' ? undefined : value;
}

const documentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['photo', 'aadhaar', 'birth_certificate', 'transfer_certificate', 'other'],
      required: true
    },
    title: { type: String, required: true },
    fileUrl: { type: String, required: true },
    storageProvider: { type: String, enum: ['local', 's3'], default: 'local' },
    storageKey: String,
    mimeType: String,
    size: Number,
    uploadedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['uploaded', 'pending', 'approved', 'rejected'], default: 'uploaded' },
    rejectReason: { type: String, trim: true }
  },
  { _id: true }
);

const guardianSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    relation: { type: String, required: true },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'Phone number must be exactly 10 digits']
    },
    email: String,
    occupation: String,
    aadhaarNumber: {
      type: String,
      trim: true,
      set: emptyToUndefined,
      match: [/^\d{12}$/, 'Aadhaar number must be exactly 12 digits']
    },
    isPrimary: { type: Boolean, default: false }
  },
  { _id: true }
);

const enrollmentSchema = new mongoose.Schema(
  {
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    rollNumber: String,
    monthlyFee: { type: Number, min: 0 },
    status: { type: String, enum: ['studying', 'promoted', 'left'], default: 'studying' },
    fromDate: { type: Date, default: Date.now },
    toDate: Date
  },
  { _id: true }
);

const activityLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    description: { type: String, required: true },
    performedBy: String,
    performedAt: { type: Date, default: Date.now },
    meta: mongoose.Schema.Types.Mixed
  },
  { _id: true }
);

const studentSchema = new mongoose.Schema(
  {
    admissionNumber: { type: String, required: true, unique: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true },
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    dateOfBirth: { type: Date, required: true },
    bloodGroup: { type: String, trim: true },
    category: { type: String, trim: true },
    nationality: { type: String, trim: true, default: 'Indian' },
    motherName: { type: String, trim: true },
    aadhaarNumber: {
      type: String,
      trim: true,
      set: emptyToUndefined,
      match: [/^\d{12}$/, 'Aadhaar number must be exactly 12 digits']
    },
    udisePenId: {
      type: String,
      trim: true,
      set: emptyToUndefined
    },
    admissionDate: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['active', 'inactive', 'left_school', 'passed_out', 'tc_issued', 'alumni'],
      default: 'active'
    },
    address: {
      line1: { type: String, required: true },
      line2: String,
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true }
    },
    previousSchoolDetails: {
      schoolName: { type: String, trim: true },
      board: { type: String, trim: true },
      percentage: Number,
      rollNumber: { type: String, trim: true },
      address: { type: String, trim: true },
      lastClass: { type: String, trim: true },
      yearOfPassing: Number,
      reasonForLeaving: { type: String, trim: true },
      tcNumber: { type: String, trim: true },
      tcDate: Date
    },
    guardians: [guardianSchema],
    documents: [documentSchema],
    enrollments: [enrollmentSchema],
    busAssignment: {
      active: { type: Boolean, default: false },
      busService: { type: Boolean, default: false },
      registrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusRegistration' },
      route: { type: mongoose.Schema.Types.ObjectId, ref: 'BusRoute' },
      routeName: { type: String, trim: true },
      routeCode: { type: String, trim: true },
      stopName: { type: String, trim: true },
      stopSequence: { type: Number },
      monthlyFee: { type: Number, default: 0, min: 0 },
      effectiveFrom: { type: String, trim: true },
      serviceStartDate: { type: Date },
      serviceEndDate: { type: Date },
      status: { type: String, enum: ['active', 'inactive'], default: 'inactive' },
      busNumber: { type: String, trim: true },
      pickupPoint: { type: String, trim: true },
      driverName: { type: String, trim: true },
      driverMobile: { type: String, trim: true }
    },
    activityLog: [activityLogSchema],
    ...auditFieldSchema
  },
  { timestamps: true }
);

studentSchema.index({ aadhaarNumber: 1 }, { unique: true, sparse: true });
studentSchema.index({ udisePenId: 1 }, { unique: true, sparse: true });

studentSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

studentSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Student', studentSchema);
