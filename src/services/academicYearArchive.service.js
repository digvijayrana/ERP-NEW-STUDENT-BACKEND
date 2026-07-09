const AcademicYear = require('../models/AcademicYear');
const AttendanceRegister = require('../models/AttendanceRegister');
const FeeInvoice = require('../models/FeeInvoice');
const PromotionBatch = require('../models/PromotionBatch');
const Payroll = require('../models/Payroll');
const { recordActivity } = require('./activityLog.service');
const { MODULES, ACTIONS } = require('../constants/activityActions');
const { withTransaction } = require('../utils/withTransaction');
const { invalidateNamespace } = require('./cache.service');

function monthYearInRange(month, year, startDate, endDate) {
  const point = new Date(year, month - 1, 15);
  return point >= new Date(startDate) && point <= new Date(endDate);
}

async function archiveAcademicYearData(yearId, user) {
  const year = await AcademicYear.findById(yearId);
  if (!year) {
    const error = new Error('Academic year not found');
    error.status = 404;
    throw error;
  }

  const result = await withTransaction(async (session) => {
    const archivedAt = year.archivedAt || new Date();
    year.archivedAt = archivedAt;
    await year.save({ session });

    const [attendanceLocked, invoicesLocked, promotionsLocked] = await Promise.all([
      AttendanceRegister.updateMany(
        { academicYear: yearId, workflowStatus: { $ne: 'locked' } },
        {
          $set: {
            workflowStatus: 'locked',
            lockedAt: archivedAt,
            lockedBy: user?._id || user?.id
          }
        },
        { session }
      ),
      FeeInvoice.updateMany(
        { academicYear: yearId, locked: { $ne: true } },
        { $set: { locked: true } },
        { session }
      ),
      PromotionBatch.updateMany(
        {
          $or: [{ fromAcademicYear: yearId }, { toAcademicYear: yearId }],
          status: 'finalized',
          locked: { $ne: true }
        },
        { $set: { locked: true } },
        { session }
      )
    ]);

    const payrollRecords = await Payroll.find({}).select('month year status locked').session(session).lean();
    const payrollIds = payrollRecords
      .filter((entry) => monthYearInRange(entry.month, entry.year, year.startDate, year.endDate))
      .map((entry) => entry._id);

    let payrollLocked = { modifiedCount: 0 };
    if (payrollIds.length) {
      payrollLocked = await Payroll.updateMany(
        { _id: { $in: payrollIds }, locked: { $ne: true }, status: 'paid' },
        {
          $set: {
            locked: true,
            lockedAt: archivedAt,
            lockedBy: user?._id || user?.id
          }
        },
        { session }
      );
    }

    return {
      archivedAt,
      attendanceLocked: attendanceLocked.modifiedCount,
      invoicesLocked: invoicesLocked.modifiedCount,
      promotionsLocked: promotionsLocked.modifiedCount,
      payrollLocked: payrollLocked.modifiedCount
    };
  });

  recordActivity({
    module: MODULES.ACADEMIC_YEARS,
    entityId: year._id,
    entityLabel: year.name,
    action: ACTIONS.CLOSE,
    description: `Academic year archived: ${year.name}`,
    user,
    meta: result
  });

  invalidateNamespace('dashboard');
  return result;
}

module.exports = {
  archiveAcademicYearData
};
