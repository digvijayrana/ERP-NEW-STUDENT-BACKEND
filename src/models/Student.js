const mongoose = require('mongoose');

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
    uploadedAt: { type: Date, default: Date.now }
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
    status: { type: String, enum: ['studying', 'promoted', 'left'], default: 'studying' },
    fromDate: { type: Date, default: Date.now },
    toDate: Date
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
    bloodGroup: String,
    aadhaarNumber: {
      type: String,
      trim: true,
      set: emptyToUndefined,
      match: [/^\d{12}$/, 'Aadhaar number must be exactly 12 digits']
    },
    admissionDate: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'inactive', 'alumni'], default: 'active' },
    address: {
      line1: { type: String, required: true },
      line2: String,
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true }
    },
    guardians: [guardianSchema],
    documents: [documentSchema],
    enrollments: [enrollmentSchema]
  },
  { timestamps: true }
);

studentSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

studentSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Student', studentSchema);
