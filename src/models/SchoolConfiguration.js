const mongoose = require('mongoose');
const DEFAULTS = require('../config/governance.defaults');
const { auditFieldSchema } = require('../utils/auditFields');

const schoolConfigurationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'master' },
    version: { type: Number, default: 1 },
    school: {
      name: String,
      address: String,
      phone: String,
      email: String,
      website: String,
      affiliation: String,
      board: String,
      logoUrl: String
    },
    academicCalendar: {
      sessionStartMonth: Number,
      workingDays: [Number],
      terms: [{ name: String, startMonth: Number, endMonth: Number }]
    },
    feePolicies: {
      defaultDueDay: Number,
      finePercentPerDay: Number,
      maxFinePercent: Number,
      allowPartialPayment: Boolean,
      lockReceiptOnPayment: Boolean,
      preventDuplicateDemands: Boolean
    },
    attendanceRules: {
      blockSunday: Boolean,
      blockHolidays: Boolean,
      blockFutureDates: Boolean,
      requireRegisterSubmission: Boolean,
      autoLockOnArchive: Boolean
    },
    promotionRules: {
      requireMandatoryDocuments: Boolean,
      requireFeesClear: Boolean,
      requireAadhaar: Boolean,
      blockInactiveClassPromotion: Boolean,
      blockOnUnresolvedWarnings: Boolean
    },
    busRules: {
      expiryWarningDays: Number,
      requireActiveRoute: Boolean,
      preventHistoricalEdit: Boolean
    },
    payrollPolicies: {
      lockOnMarkPaid: Boolean,
      requireActiveTeacher: Boolean,
      defaultPaymentMode: String,
      allowDeletePendingOnly: Boolean
    },
    softDeletePolicy: {
      enforceSoftDelete: Boolean,
      allowHardDelete: Boolean,
      retentionDays: Number
    },
    ...auditFieldSchema
  },
  { timestamps: true }
);

schoolConfigurationSchema.statics.seedDefaults = function seedDefaults() {
  return this.findOneAndUpdate(
    { key: 'master' },
    { $setOnInsert: { ...DEFAULTS, version: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

module.exports = mongoose.model('SchoolConfiguration', schoolConfigurationSchema);
