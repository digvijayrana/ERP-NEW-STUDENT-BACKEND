module.exports = {
  school: {
    name: process.env.SCHOOL_NAME || 'Student ERP School',
    address: process.env.SCHOOL_ADDRESS || '',
    phone: process.env.SCHOOL_PHONE || '',
    email: process.env.SCHOOL_EMAIL || '',
    website: '',
    affiliation: '',
    board: 'CBSE'
  },
  academicCalendar: {
    sessionStartMonth: 4,
    workingDays: [1, 2, 3, 4, 5, 6],
    terms: [
      { name: 'Term 1', startMonth: 4, endMonth: 9 },
      { name: 'Term 2', startMonth: 10, endMonth: 3 }
    ]
  },
  feePolicies: {
    defaultDueDay: 10,
    finePercentPerDay: 0,
    maxFinePercent: 10,
    allowPartialPayment: true,
    lockReceiptOnPayment: true,
    preventDuplicateDemands: true
  },
  attendanceRules: {
    blockSunday: true,
    blockHolidays: true,
    blockFutureDates: true,
    requireRegisterSubmission: true,
    autoLockOnArchive: true
  },
  promotionRules: {
    requireMandatoryDocuments: true,
    requireFeesClear: false,
    requireAadhaar: false,
    blockInactiveClassPromotion: true,
    blockOnUnresolvedWarnings: false
  },
  busRules: {
    expiryWarningDays: 30,
    requireActiveRoute: true,
    preventHistoricalEdit: true
  },
  payrollPolicies: {
    lockOnMarkPaid: true,
    requireActiveTeacher: true,
    defaultPaymentMode: 'bank_transfer',
    allowDeletePendingOnly: true
  },
  softDeletePolicy: {
    enforceSoftDelete: true,
    allowHardDelete: false,
    retentionDays: 0
  }
};
