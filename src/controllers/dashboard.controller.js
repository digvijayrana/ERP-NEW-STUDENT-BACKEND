const AcademicYear = require('../models/AcademicYear');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Activity = require('../models/Activity');
const Attendance = require('../models/Attendance');
const FeeInvoice = require('../models/FeeInvoice');
const BusRegistration = require('../models/BusRegistration');
const Payroll = require('../models/Payroll');
const asyncHandler = require('../middleware/asyncHandler');
const { createLogger } = require('../utils/logger');
const { ACTIONS } = require('../constants/activityActions');
const { ROLES } = require('../constants');

const log = createLogger('dashboard');
const MANDATORY_DOC_TYPES = ['photo', 'birth_certificate'];
const RECENT_ACTIVITY_LIMIT = 20;
const PRESENT_STATUSES = new Set(['present', 'late', 'half_day']);

const ACTION_TYPE_MAP = {
  [ACTIONS.ADMISSION]: 'student_admission',
  [ACTIONS.REGISTRATION]: 'teacher_registration',
  [ACTIONS.CREATE]: 'record_create',
  [ACTIONS.UPDATE]: 'record_update',
  [ACTIONS.ACTIVATE]: 'academic_year_activate',
  [ACTIONS.CLOSE]: 'academic_year_close',
  [ACTIONS.STATUS_CHANGE]: 'status_change',
  [ACTIONS.PERMISSION_CHANGE]: 'permission_change',
  [ACTIONS.ROLE_ASSIGNMENT]: 'role_assignment',
  [ACTIONS.CLASS_TEACHER_ASSIGNMENT]: 'class_teacher_assignment',
  [ACTIONS.DEACTIVATE]: 'deactivate'
};

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

function mapActivityRecord(entry) {
  return {
    type: ACTION_TYPE_MAP[entry.action] || entry.action,
    description: entry.description,
    performedBy: entry.performedBy?.email || entry.performedBy?.name,
    performedAt: entry.performedAt,
    meta: {
      module: entry.module,
      entityId: entry.entityId,
      entityLabel: entry.entityLabel,
      ...entry.meta
    }
  };
}

async function buildRecentActivitiesFromStore(limit = RECENT_ACTIVITY_LIMIT) {
  const activities = await Activity.find({})
    .sort({ performedAt: -1 })
    .limit(limit)
    .lean();

  if (activities.length) {
    return activities.map(mapActivityRecord);
  }
  return buildLegacyRecentActivities(limit);
}

async function buildLegacyRecentActivities(limit = RECENT_ACTIVITY_LIMIT) {
  const [recentAdmissions, recentTeachers, recentClasses, studentsWithStatusLogs] = await Promise.all([
    Student.find({})
      .sort({ admissionDate: -1, createdAt: -1 })
      .limit(10)
      .select('firstName lastName admissionNumber admissionDate createdAt activityLog')
      .lean(),
    Teacher.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .select('firstName lastName employeeCode createdAt')
      .lean(),
    ClassRoom.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .select('name section createdAt')
      .lean(),
    Student.find({ 'activityLog.action': 'status_change' })
      .select('firstName lastName admissionNumber activityLog')
      .lean()
  ]);

  const activities = [];

  recentAdmissions.forEach((student) => {
    const admissionEntry = (student.activityLog || []).find((entry) => entry.action === 'admission');
    activities.push({
      type: 'student_admission',
      description: `Student admitted: ${student.firstName} ${student.lastName || ''}`.trim(),
      performedBy: admissionEntry?.performedBy,
      performedAt: student.admissionDate || student.createdAt,
      meta: { admissionNumber: student.admissionNumber, studentId: student._id }
    });
  });

  recentTeachers.forEach((teacher) => {
    activities.push({
      type: 'teacher_registration',
      description: `Teacher registered: ${teacher.firstName} ${teacher.lastName || ''}`.trim(),
      performedAt: teacher.createdAt,
      meta: { employeeCode: teacher.employeeCode, teacherId: teacher._id }
    });
  });

  recentClasses.forEach((room) => {
    activities.push({
      type: 'class_creation',
      description: `Class created: ${room.name}-${room.section}`,
      performedAt: room.createdAt,
      meta: { classRoomId: room._id, name: room.name, section: room.section }
    });
  });

  studentsWithStatusLogs.forEach((student) => {
    (student.activityLog || [])
      .filter((entry) => entry.action === 'status_change')
      .forEach((entry) => {
        activities.push({
          type: 'student_status_change',
          description: entry.description || `Status changed for ${student.admissionNumber}`,
          performedBy: entry.performedBy,
          performedAt: entry.performedAt,
          meta: {
            admissionNumber: student.admissionNumber,
            studentId: student._id,
            previousStatus: entry.meta?.previousStatus,
            newStatus: entry.meta?.newStatus || entry.meta?.status
          }
        });
      });
  });

  return activities
    .filter((entry) => entry.performedAt)
    .sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt))
    .slice(0, limit);
}

async function buildRecentActivities(limit = RECENT_ACTIVITY_LIMIT) {
  return buildRecentActivitiesFromStore(limit);
}

function studentLabel(student) {
  if (!student) return '';
  return [student.firstName, student.lastName].filter(Boolean).join(' ');
}

async function buildOperationalAnalytics(activeYear) {
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const now = new Date();
  const payrollMonth = now.getMonth() + 1;
  const payrollYear = now.getFullYear();

  const [
    todayAttendanceRecords,
    feeInvoices,
    busStudents,
    payrollRecords,
    recentPayments
  ] = await Promise.all([
    Attendance.find({ date: { $gte: todayStart, $lte: todayEnd } }).select('status').lean(),
    FeeInvoice.find({ status: { $ne: 'cancelled' } })
      .populate('student', 'firstName lastName admissionNumber')
      .lean({ virtuals: true }),
    BusRegistration.countDocuments({
      status: 'active',
      busService: true,
      ...(activeYear ? { academicYear: activeYear._id } : {})
    }),
    Payroll.find({ month: payrollMonth, year: payrollYear }).lean({ virtuals: true }),
    FeeInvoice.find({ status: { $ne: 'cancelled' }, 'payments.0': { $exists: true } })
      .populate('student', 'firstName lastName admissionNumber')
      .sort({ updatedAt: -1 })
      .limit(40)
      .lean({ virtuals: true })
  ]);

  const todaysAttendance = {
    present: todayAttendanceRecords.filter((row) => PRESENT_STATUSES.has(row.status)).length,
    absent: todayAttendanceRecords.filter((row) => row.status === 'absent').length,
    leave: todayAttendanceRecords.filter((row) => row.status === 'leave').length,
    total: todayAttendanceRecords.length
  };

  let todaysFeeCollection = 0;
  let pendingFees = 0;
  for (const invoice of feeInvoices) {
    pendingFees += invoice.balanceAmount || 0;
    for (const payment of invoice.payments || []) {
      if (payment.status === 'void' || !payment.paidAt) continue;
      const paidAt = new Date(payment.paidAt);
      if (paidAt >= todayStart && paidAt <= todayEnd) {
        todaysFeeCollection += payment.amount || 0;
      }
    }
  }

  const payrollStatus = {
    month: payrollMonth,
    year: payrollYear,
    total: payrollRecords.length,
    paid: payrollRecords.filter((row) => row.status === 'paid').length,
    pending: payrollRecords.filter((row) => row.status === 'pending').length,
    paidAmount: payrollRecords
      .filter((row) => row.status === 'paid')
      .reduce((sum, row) => sum + (row.netSalary || 0), 0),
    pendingAmount: payrollRecords
      .filter((row) => row.status === 'pending')
      .reduce((sum, row) => sum + (row.netSalary || 0), 0)
  };

  const recentFeeCollections = [];
  for (const invoice of recentPayments) {
    for (const payment of (invoice.payments || []).filter((row) => row.status !== 'void')) {
      recentFeeCollections.push({
        studentName: studentLabel(invoice.student),
        admissionNumber: invoice.student?.admissionNumber || '',
        amount: payment.amount,
        receiptNumber: payment.receiptNumber,
        paidAt: payment.paidAt,
        mode: payment.mode,
        feeMonth: `${invoice.feeMonth}/${invoice.feeYear}`
      });
    }
  }

  recentFeeCollections.sort((a, b) => new Date(b.paidAt || 0) - new Date(a.paidAt || 0));

  return {
    todaysAttendance,
    todaysFeeCollection,
    pendingFees,
    busStudents,
    payrollStatus,
    recentFeeCollections: recentFeeCollections.slice(0, 10)
  };
}

async function buildAdminDashboard(activeYear) {
  const classFilter = activeYear ? { academicYear: activeYear._id } : {};
  const todayStart = startOfToday();
  const todayEnd = endOfToday();

  const [
    totalStudents,
    activeStudents,
    totalTeachers,
    activeTeachers,
    totalSections,
    distinctClassNames,
    todaysAdmissions,
    pendingDocuments,
    recentActivities,
    operationalAnalytics
  ] = await Promise.all([
    Student.countDocuments({}),
    Student.countDocuments({ status: 'active' }),
    Teacher.countDocuments({}),
    Teacher.countDocuments({ status: 'active' }),
    ClassRoom.countDocuments(classFilter),
    ClassRoom.distinct('name', classFilter),
    Student.countDocuments({ admissionDate: { $gte: todayStart, $lte: todayEnd } }),
    Student.countDocuments(missingMandatoryDocsFilter()),
    buildRecentActivities(),
    buildOperationalAnalytics(activeYear)
  ]);

  return {
    activeYear,
    totalStudents,
    activeStudents,
    totalTeachers,
    activeTeachers,
    totalClasses: distinctClassNames.length,
    totalSections,
    todaysAdmissions,
    pendingDocuments,
    recentActivities,
    operational: operationalAnalytics,
    students: totalStudents,
    teachers: totalTeachers
  };
}

async function buildScopedDashboard(req, activeYear) {
  let studentFilter = {};
  let teacherFilter = { status: 'active' };

  if (req.user.role === ROLES.TEACHER) {
    const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
    studentFilter = { 'enrollments.classRoom': { $in: classIds } };
    teacherFilter = { _id: req.user.teacher };
  }

  if (req.user.role === ROLES.STUDENT) {
    studentFilter = { _id: req.user.student };
    teacherFilter = { _id: null };
  }

  if (req.user.role === ROLES.PARENT) {
    const childIds = req.user.linkedStudents?.length
      ? req.user.linkedStudents
      : (req.user.linkedStudent ? [req.user.linkedStudent] : []);
    studentFilter = { _id: { $in: childIds } };
    teacherFilter = { _id: null };
  }

  const [students, activeStudents, teachers] = await Promise.all([
    Student.countDocuments(studentFilter),
    Student.countDocuments({ ...studentFilter, status: 'active' }),
    Teacher.countDocuments(teacherFilter)
  ]);

  return {
    activeYear,
    students,
    activeStudents,
    teachers,
    totalStudents: students,
    activeTeachers: teachers
  };
}

exports.getDashboard = asyncHandler(async (req, res) => {
  const activeYear = await AcademicYear.findOne({ $or: [{ status: 'active' }, { isActive: true }] })
    .sort({ startDate: -1 })
    .lean();

  const payload = req.user.role === ROLES.ADMIN || req.user.role === ROLES.SUPER_ADMIN
    ? await buildAdminDashboard(activeYear)
    : await buildScopedDashboard(req, activeYear);

  log.info('Dashboard loaded', { user: req.user.email, role: req.user.role });
  res.json(payload);
});
