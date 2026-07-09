const AcademicYear = require('../models/AcademicYear');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const FeeInvoice = require('../models/FeeInvoice');
const Payroll = require('../models/Payroll');
const BusRegistration = require('../models/BusRegistration');
const AttendanceRegister = require('../models/AttendanceRegister');
const PromotionBatch = require('../models/PromotionBatch');
const NotificationDismissal = require('../models/NotificationDismissal');
const { hasPermission } = require('./permission.service');
const { getPolicySection } = require('./governanceConfig.service');
const { MANDATORY_DOC_TYPES } = require('../config/workflow.config');

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function missingMandatoryDocsFilter() {
  return {
    $or: MANDATORY_DOC_TYPES.map((type) => ({
      documents: { $not: { $elemMatch: { type, fileUrl: { $exists: true, $nin: [null, ''] } } } }
    }))
  };
}

function canViewModule(user, permissions, module) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return hasPermission(permissions, module, 'view');
}

async function countPendingFees(activeYearId) {
  if (!activeYearId) return 0;
  return FeeInvoice.countDocuments({
    academicYear: activeYearId,
    status: { $in: ['unpaid', 'partial'] }
  });
}

async function countMissingAttendance(activeYearId) {
  if (!activeYearId) return 0;
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const activeClasses = await ClassRoom.find({ academicYear: activeYearId, status: 'active' }).distinct('_id');
  if (!activeClasses.length) return 0;

  const markedClasses = await AttendanceRegister.distinct('classRoom', {
    academicYear: activeYearId,
    date: { $gte: todayStart, $lte: todayEnd }
  });

  return Math.max(activeClasses.length - markedClasses.length, 0);
}

async function countPendingPromotions(activeYearId) {
  if (!activeYearId) return 0;
  const draftBatches = await PromotionBatch.countDocuments({
    fromAcademicYear: activeYearId,
    status: 'draft'
  });
  if (draftBatches) return draftBatches;

  const activeStudents = await Student.countDocuments({
    status: 'active',
    enrollments: {
      $elemMatch: {
        academicYear: activeYearId,
        status: 'studying'
      }
    }
  });
  const finalizedFromYear = await PromotionBatch.countDocuments({
    fromAcademicYear: activeYearId,
    status: 'finalized'
  });
  return finalizedFromYear ? 0 : (activeStudents > 0 ? 1 : 0);
}

async function countPendingPayroll() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const activeTeachers = await Teacher.countDocuments({ status: 'active' });
  const payrollCount = await Payroll.countDocuments({ month, year });
  return Math.max(activeTeachers - payrollCount, 0);
}

async function countBusServiceExpiry(activeYearId) {
  if (!activeYearId) return 0;
  const busRules = await getPolicySection('busRules');
  const warningDays = busRules.expiryWarningDays || 30;
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + warningDays);
  return BusRegistration.countDocuments({
    academicYear: activeYearId,
    status: 'active',
    busService: true,
    serviceEndDate: { $lte: warningDate, $gte: new Date() }
  });
}

async function countMissingDocuments() {
  return Student.countDocuments({
    status: 'active',
    ...missingMandatoryDocsFilter()
  });
}

function buildNotification({ key, title, message, count, severity, tab, action }) {
  return { key, title, message, count, severity, tab, action };
}

async function buildSmartNotifications(user, permissions) {
  const activeYear = await AcademicYear.findOne({ status: 'active' }).lean();
  const activeYearId = activeYear?._id;
  const notifications = [];

  if (canViewModule(user, permissions, 'fees')) {
    const count = await countPendingFees(activeYearId);
    if (count > 0) {
      notifications.push(buildNotification({
        key: 'pending_fees',
        title: 'Pending fee payments',
        message: `${count} invoice(s) have outstanding balances for the active academic year.`,
        count,
        severity: 'warning',
        tab: 'fees',
        action: 'Review fee invoices'
      }));
    }
  }

  if (canViewModule(user, permissions, 'attendance')) {
    const count = await countMissingAttendance(activeYearId);
    if (count > 0) {
      notifications.push(buildNotification({
        key: 'missing_attendance',
        title: 'Missing attendance',
        message: `${count} class(es) have not submitted attendance for today.`,
        count,
        severity: 'warning',
        tab: 'attendance',
        action: 'Mark attendance'
      }));
    }
  }

  if (canViewModule(user, permissions, 'students')) {
    const count = await countPendingPromotions(activeYearId);
    if (count > 0) {
      notifications.push(buildNotification({
        key: 'pending_promotions',
        title: 'Pending student promotions',
        message: count === 1
          ? 'Student promotions are pending for the active academic year.'
          : `${count} promotion batch(es) are still in draft.`,
        count,
        severity: 'info',
        tab: 'promotion',
        action: 'Open promotion wizard'
      }));
    }
  }

  if (canViewModule(user, permissions, 'payroll')) {
    const count = await countPendingPayroll();
    if (count > 0) {
      notifications.push(buildNotification({
        key: 'pending_payroll',
        title: 'Pending payroll processing',
        message: `${count} active teacher(s) do not have payroll records for the current month.`,
        count,
        severity: 'warning',
        tab: 'payroll',
        action: 'Process payroll'
      }));
    }
  }

  if (canViewModule(user, permissions, 'transport')) {
    const count = await countBusServiceExpiry(activeYearId);
    if (count > 0) {
      notifications.push(buildNotification({
        key: 'bus_service_expiry',
        title: 'Bus service expiry',
        message: `${count} bus registration(s) expire within ${warningDays} days.`,
        count,
        severity: 'warning',
        tab: 'transport',
        action: 'Review bus registrations'
      }));
    }
  }

  if (canViewModule(user, permissions, 'students')) {
    const count = await countMissingDocuments();
    if (count > 0) {
      notifications.push(buildNotification({
        key: 'missing_documents',
        title: 'Missing mandatory documents',
        message: `${count} active student(s) are missing photo or birth certificate.`,
        count,
        severity: 'info',
        tab: 'students',
        action: 'Review student documents'
      }));
    }
  }

  return notifications;
}

async function listNotifications(user, permissions) {
  const notifications = await buildSmartNotifications(user, permissions);
  const dismissed = await NotificationDismissal.find({ user: user._id || user.id }).lean();
  const dismissedKeys = new Set(dismissed.map((entry) => entry.notificationKey));
  return notifications.filter((entry) => !dismissedKeys.has(entry.key));
}

async function dismissNotification(user, notificationKey) {
  await NotificationDismissal.findOneAndUpdate(
    { user: user._id || user.id, notificationKey },
    { dismissedAt: new Date() },
    { upsert: true, new: true }
  );
  return { dismissed: true, notificationKey };
}

async function resetDismissals(user) {
  await NotificationDismissal.deleteMany({ user: user._id || user.id });
  return { cleared: true };
}

module.exports = {
  buildSmartNotifications,
  listNotifications,
  dismissNotification,
  resetDismissals
};
