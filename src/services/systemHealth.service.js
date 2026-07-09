const Activity = require('../models/Activity');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const FeeInvoice = require('../models/FeeInvoice');
const Payroll = require('../models/Payroll');
const AttendanceRegister = require('../models/AttendanceRegister');
const PromotionBatch = require('../models/PromotionBatch');
const { ACTIONS } = require('../constants/activityActions');
const { listNotifications } = require('./workflowNotification.service');
const { buildDataQualityReport, missingMandatoryDocsFilter } = require('./dataQuality.service');
const { MANDATORY_DOC_TYPES } = require('../config/workflow.config');

async function countIncompleteStudentProfiles() {
  return Student.countDocuments({
    status: 'active',
    isDeleted: { $ne: true },
    ...missingMandatoryDocsFilter(MANDATORY_DOC_TYPES)
  });
}

async function countIncompleteTeacherProfiles() {
  return Teacher.countDocuments({
    status: 'active',
    isDeleted: { $ne: true },
    $or: [
      { email: { $in: [null, ''] } },
      { qualification: { $in: [null, ''] } },
      { aadhaarNumber: { $in: [null, ''] } }
    ]
  });
}

async function countFailedOperations(days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return Activity.countDocuments({
    action: { $in: [ACTIONS.INTEGRITY_VIOLATION, ACTIONS.DATA_QUALITY_WARNING] },
    performedAt: { $gte: since }
  });
}

async function countLockedTransactions() {
  const [feeReceipts, payrollRecords, attendanceRegisters, promotionBatches] = await Promise.all([
    FeeInvoice.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $unwind: '$payments' },
      { $match: { 'payments.locked': true, 'payments.status': 'active' } },
      { $count: 'total' }
    ]).then((rows) => rows[0]?.total || 0),
    Payroll.countDocuments({ locked: true, isDeleted: { $ne: true } }),
    AttendanceRegister.countDocuments({ workflowStatus: 'locked', isDeleted: { $ne: true } }),
    PromotionBatch.countDocuments({ locked: true, isDeleted: { $ne: true } })
  ]);

  return {
    feeReceipts,
    payroll: payrollRecords,
    attendance: attendanceRegisters,
    promotions: promotionBatches,
    total: feeReceipts + payrollRecords + attendanceRegisters + promotionBatches
  };
}

async function buildSystemHealth(user, permissions) {
  const [pendingNotifications, incompleteStudents, incompleteTeachers, failedOperations, lockedTransactions, dataQuality] =
    await Promise.all([
      listNotifications(user, permissions),
      countIncompleteStudentProfiles(),
      countIncompleteTeacherProfiles(),
      countFailedOperations(),
      countLockedTransactions(),
      buildDataQualityReport()
    ]);

  const recentFailures = await Activity.find({
    action: { $in: [ACTIONS.INTEGRITY_VIOLATION, ACTIONS.DATA_QUALITY_WARNING] }
  })
    .sort({ performedAt: -1 })
    .limit(10)
    .lean();

  return {
    status: dataQuality.summary.totalWarnings > 0 || failedOperations > 0 ? 'attention' : 'healthy',
    pendingActivities: {
      count: pendingNotifications.length,
      items: pendingNotifications.slice(0, 8)
    },
    incompleteProfiles: {
      students: incompleteStudents,
      teachers: incompleteTeachers,
      total: incompleteStudents + incompleteTeachers
    },
    failedOperations: {
      count: failedOperations,
      recent: recentFailures.map((entry) => ({
        action: entry.action,
        description: entry.description,
        performedAt: entry.performedAt,
        module: entry.module,
        entityLabel: entry.entityLabel
      }))
    },
    lockedTransactions,
    dataQuality: {
      summary: dataQuality.summary,
      warnings: dataQuality.warnings.slice(0, 12)
    },
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  buildSystemHealth
};
