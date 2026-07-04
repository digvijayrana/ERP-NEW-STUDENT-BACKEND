const AcademicYear = require('../models/AcademicYear');
const ClassRoom = require('../models/ClassRoom');
const Exam = require('../models/Exam');
const ExamSubmission = require('../models/ExamSubmission');
const FeeInvoice = require('../models/FeeInvoice');
const Payroll = require('../models/Payroll');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const asyncHandler = require('../middleware/asyncHandler');
const { ROLES, PAGINATION } = require('../constants');

exports.getDashboard = asyncHandler(async (req, res) => {
  const activeYear = await AcademicYear.findOne({ isActive: true }).lean();
  const allowedRanges = [7, 30, 365];
  const rangeDays = Number(req.query.rangeDays || allowedRanges[1]);
  const windowDays = allowedRanges.includes(rangeDays) ? rangeDays : allowedRanges[1];
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - windowDays);

  let studentFilter = { status: 'active' };
  let feeFilter = {};
  let teacherFilter = { status: 'active' };
  let payrollFilter = {};
  let examFilter = {};
  let submissionFilter = { status: 'graded', submittedAt: { $gte: fromDate } };

  if (req.user.role === ROLES.TEACHER) {
    const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
    studentFilter = { status: 'active', 'enrollments.classRoom': { $in: classIds } };
    feeFilter = { classRoom: { $in: classIds } };
    teacherFilter = { _id: req.user.teacher };
    payrollFilter = { teacher: req.user.teacher };
    examFilter = { classRoom: { $in: classIds } };
    const examIds = await Exam.find(examFilter).distinct('_id');
    submissionFilter.exam = { $in: examIds };
  }

  if (req.user.role === ROLES.STUDENT) {
    studentFilter = { _id: req.user.student };
    feeFilter = { student: req.user.student };
    teacherFilter = { _id: null };
    payrollFilter = { _id: null };
    submissionFilter.student = req.user.student;
    const student = await Student.findById(req.user.student).lean();
    const classIds = (student?.enrollments || []).map((e) => e.classRoom);
    examFilter = { classRoom: { $in: classIds }, status: { $in: ['published', 'closed'] } };
  }

  if (req.user.role === ROLES.PARENT) {
    const childIds = req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : []);
    studentFilter = { _id: { $in: childIds } };
    feeFilter = { student: { $in: childIds } };
    teacherFilter = { _id: null };
    payrollFilter = { _id: null };
    submissionFilter.student = { $in: childIds };
    const children = await Student.find({ _id: { $in: childIds } }).lean();
    const classIds = children.flatMap((s) => (s.enrollments || []).map((e) => e.classRoom));
    examFilter = { classRoom: { $in: classIds }, status: { $in: ['published', 'closed'] } };
  }

  const [students, teachers, feeInvoices, payrolls, exams, recentSubmissions] = await Promise.all([
    Student.countDocuments(studentFilter),
    Teacher.countDocuments(teacherFilter),
    FeeInvoice.find(feeFilter).lean({ virtuals: true }),
    Payroll.find(payrollFilter).lean({ virtuals: true }),
    Exam.countDocuments(examFilter),
    ExamSubmission.find(submissionFilter).sort({ submittedAt: -1 }).limit(PAGINATION.DASHBOARD_RECENT_SUBMISSIONS)
      .populate('student', 'firstName lastName admissionNumber')
      .populate('exam', 'title subject')
      .lean()
  ]);

  const feeCollected = feeInvoices.reduce(
    (sum, invoice) =>
      sum +
      invoice.payments
        .filter((payment) => !payment.paidAt || new Date(payment.paidAt) >= fromDate)
        .reduce((paid, payment) => paid + payment.amount, 0),
    0
  );
  const feeDue = feeInvoices.reduce((sum, invoice) => {
    const total = invoice.items.reduce((itemSum, item) => itemSum + item.amount, 0) + invoice.fine - invoice.discount;
    const paid = invoice.payments.reduce((paidSum, payment) => paidSum + payment.amount, 0);
    return sum + Math.max(total - paid, 0);
  }, 0);
  const payrollDue = payrolls
    .filter((payroll) => payroll.status === 'pending' || (payroll.paidAt && new Date(payroll.paidAt) >= fromDate))
    .reduce((sum, payroll) => sum + payroll.basicSalary + payroll.allowances - payroll.deductions, 0);

  const averageExamScore = recentSubmissions.length
    ? Math.round(recentSubmissions.reduce((sum, s) => sum + (s.percentage || 0), 0) / recentSubmissions.length)
    : 0;

  res.json({
    students,
    teachers,
    activeYear,
    feeCollected,
    feeDue,
    payrollDue,
    rangeDays: windowDays,
    exams,
    averageExamScore,
    recentExamResults: recentSubmissions
  });
});
