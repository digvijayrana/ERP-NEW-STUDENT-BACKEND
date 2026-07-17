const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');

const PIPELINE_STAGES = [
  'new',
  'contacted',
  'qualified',
  'documents_pending',
  'interview_scheduled',
  'scholarship_review',
  'converted',
  'lost'
];

const DOC_CHECKLIST = ['photo', 'birthCertificate', 'aadhaar', 'transferCertificate', 'marksheet'];

const chatMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    text: { type: String, required: true, trim: true },
    intent: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const documentCheckSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    status: { type: String, enum: ['missing', 'submitted', 'verified', 'rejected'], default: 'missing' },
    notes: { type: String, trim: true }
  },
  { _id: false }
);

const admissionLeadSchema = new mongoose.Schema(
  {
    leadCode: { type: String, unique: true, trim: true, uppercase: true },
    // Parent / applicant contact
    parentName: { type: String, required: true, trim: true },
    parentPhone: {
      type: String,
      trim: true,
      validate: {
        validator(value) {
          if (value == null || value === '') return true;
          return /^\d{10}$/.test(value);
        },
        message: 'Phone must be exactly 10 digits'
      }
    },
    parentEmail: { type: String, trim: true, lowercase: true },
    relation: { type: String, trim: true, default: 'Father' },
    // Child
    childName: { type: String, required: true, trim: true },
    childGender: { type: String, enum: ['male', 'female', 'other', ''], default: '' },
    dateOfBirth: { type: Date },
    applyingClass: { type: String, trim: true },
    previousSchool: { type: String, trim: true },
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear' },
    // CRM
    stage: { type: String, enum: PIPELINE_STAGES, default: 'new' },
    source: { type: String, enum: ['chatbot', 'walk_in', 'phone', 'referral', 'website', 'other'], default: 'chatbot' },
    notes: { type: String, trim: true },
    tags: [{ type: String, trim: true }],
    // AI scores
    qualificationScore: { type: Number, default: 0, min: 0, max: 100 },
    qualificationLabel: { type: String, enum: ['hot', 'warm', 'cold', 'disqualified', ''], default: '' },
    eligibility: {
      eligible: { type: Boolean, default: null },
      reasons: [{ type: String }],
      recommendedClass: { type: String, trim: true },
      ageYears: { type: Number }
    },
    feeEstimate: {
      academicYearName: String,
      className: String,
      total: { type: Number, default: 0 },
      components: [
        {
          key: String,
          label: String,
          amount: Number,
          frequency: String,
          newAdmissionOnly: Boolean
        }
      ]
    },
    scholarship: {
      suggested: { type: Boolean, default: false },
      type: { type: String, trim: true },
      percent: { type: Number, default: 0 },
      reasons: [{ type: String }]
    },
    documents: { type: [documentCheckSchema], default: [] },
    interview: {
      scheduledAt: Date,
      mode: { type: String, enum: ['in_person', 'online', 'phone', ''], default: '' },
      status: { type: String, enum: ['none', 'scheduled', 'completed', 'no_show', 'cancelled'], default: 'none' },
      notes: String
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    convertedStudent: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    chatSessionId: { type: String, trim: true, index: true },
    chatHistory: { type: [chatMessageSchema], default: [] },
    lastActivityAt: { type: Date, default: Date.now },
    ...auditFieldSchema
  },
  { timestamps: true }
);

admissionLeadSchema.index({ stage: 1, createdAt: -1 });
admissionLeadSchema.index({ parentPhone: 1 });
admissionLeadSchema.index({ qualificationLabel: 1 });
admissionLeadSchema.index({ 'interview.scheduledAt': 1 });

admissionLeadSchema.pre('validate', function ensureDocs(next) {
  if (!this.documents?.length) {
    this.documents = DOC_CHECKLIST.map((key) => ({
      key,
      label: {
        photo: 'Passport photo',
        birthCertificate: 'Birth certificate',
        aadhaar: 'Aadhaar card',
        transferCertificate: 'Transfer certificate',
        marksheet: 'Previous marksheet'
      }[key] || key,
      status: key === 'transferCertificate' || key === 'marksheet' ? 'missing' : 'missing'
    }));
  }
  next();
});

module.exports = mongoose.model('AdmissionLead', admissionLeadSchema);
module.exports.PIPELINE_STAGES = PIPELINE_STAGES;
module.exports.DOC_CHECKLIST = DOC_CHECKLIST;
