const Attendance = require('../models/Attendance');
const ClassRoom = require('../models/ClassRoom');
const ExamSubmission = require('../models/ExamSubmission');
const FeeInvoice = require('../models/FeeInvoice');
const Student = require('../models/Student');
const asyncHandler = require('../middleware/asyncHandler');
const { createLogger } = require('../utils/logger');
const { analyzeStudentProfile } = require('../services/aiStudentInsight.service');

const log = createLogger('students');

async function assertStudentAccess(req, studentId) {
  if (req.user.role === 'student' && req.user.student?.toString() !== studentId) {
    return { error: 'Students can only access their own profile', status: 403 };
  }
  if (req.user.role === 'parent' && req.user.linkedStudent?.toString() !== studentId) {
    return { error: 'Parents can only access their linked child profile', status: 403 };
  }
  if (req.user.role === 'teacher') {
    const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
    const student = await Student.findById(studentId).lean();
    if (!student) return { error: 'Student not found', status: 404 };
    const canAccess = student.enrollments?.some((e) => classIds.some((id) => id.equals(e.classRoom)));
    if (!canAccess) return { error: 'Teacher can only access assigned class students', status: 403 };
  }
  return null;
}

exports.getProfile = asyncHandler(async (req, res) => {
  const accessError = await assertStudentAccess(req, req.params.id);
  if (accessError) return res.status(accessError.status).json({ message: accessError.error });

  const student = await Student.findById(req.params.id)
    .populate('enrollments.academicYear', 'name isActive')
    .populate('enrollments.classRoom', 'name section monthlyFee classTeacher')
    .populate('enrollments.classRoom.classTeacher', 'firstName lastName phone email');

  if (!student) return res.status(404).json({ message: 'Student not found' });

  const latestEnrollment = student.enrollments?.filter((e) => e.status === 'studying').pop()
    || student.enrollments?.[student.enrollments.length - 1];

  const [attendanceRecords, examSubmissions, feeInvoices, classMates] = await Promise.all([
    Attendance.find({ student: student._id }).sort({ date: -1 }).limit(90).lean(),
    ExamSubmission.find({ student: student._id, status: 'graded' })
      .populate({ path: 'exam', select: 'title subject chapter totalMarks classRoom', populate: { path: 'classRoom', select: 'name section' } })
      .sort({ submittedAt: -1 })
      .lean(),
    FeeInvoice.find({ student: student._id }).lean({ virtuals: true }),
    latestEnrollment?.classRoom
      ? Student.find({
          _id: { $ne: student._id },
          'enrollments.classRoom': latestEnrollment.classRoom._id || latestEnrollment.classRoom,
          'enrollments.status': 'studying',
          status: 'active'
        }).select('_id').lean()
      : Promise.resolve([])
  ]);

  const totalAttendance = attendanceRecords.length;
  const present = attendanceRecords.filter((r) => ['present', 'late', 'half_day'].includes(r.status)).length;
  const absent = attendanceRecords.filter((r) => r.status === 'absent').length;
  const attendancePercentage = totalAttendance ? Math.round((present / totalAttendance) * 100) : 100;

  const examResults = examSubmissions.map((s) => ({
    examId: s.exam?._id,
    title: s.exam?.title,
    subject: s.exam?.subject,
    chapter: s.exam?.chapter,
    score: s.score,
    maxScore: s.maxScore,
    percentage: s.percentage,
    grade: s.grade,
    submittedAt: s.submittedAt
  }));

  const averageScore = examResults.length
    ? Math.round(examResults.reduce((sum, e) => sum + e.percentage, 0) / examResults.length)
    : 0;

  const subjectMap = new Map();
  examResults.forEach((e) => {
    if (!e.subject) return;
    const entry = subjectMap.get(e.subject) || { total: 0, count: 0 };
    entry.total += e.percentage;
    entry.count += 1;
    subjectMap.set(e.subject, entry);
  });
  const subjectBreakdown = Array.from(subjectMap.entries()).map(([subject, data]) => ({
    subject,
    average: Math.round(data.total / data.count),
    attempts: data.count
  }));

  const totalFeeDue = feeInvoices.reduce((sum, inv) => sum + (inv.balanceAmount || 0), 0);
  const totalFeePaid = feeInvoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
  const feeStatus = totalFeeDue <= 0 ? 'paid' : feeInvoices.some((i) => i.status === 'partial') ? 'partial' : 'unpaid';

  const photoDoc = student.documents?.find((d) => d.type === 'photo');

  const profilePayload = {
    student: {
      _id: student._id,
      admissionNumber: student.admissionNumber,
      firstName: student.firstName,
      lastName: student.lastName,
      gender: student.gender,
      dateOfBirth: student.dateOfBirth,
      status: student.status,
      address: student.address,
      guardians: student.guardians,
      photoUrl: photoDoc?.fileUrl || null
    },
    academic: {
      className: latestEnrollment?.classRoom
        ? `${latestEnrollment.classRoom.name}-${latestEnrollment.classRoom.section}`
        : 'Unassigned',
      classRoom: latestEnrollment?.classRoom,
      academicYear: latestEnrollment?.academicYear,
      rollNumber: latestEnrollment?.rollNumber || '—',
      classTeacher: latestEnrollment?.classRoom?.classTeacher || null,
      classRank: null
    },
    attendance: {
      percentage: attendancePercentage,
      present,
      absent,
      total: totalAttendance,
      recent: attendanceRecords.slice(0, 30).map((r) => ({ date: r.date, status: r.status }))
    },
    academics: {
      averageScore,
      examCount: examResults.length,
      examResults: examResults.slice(0, 10),
      subjectBreakdown,
      performanceTrend: examResults.slice(0, 6).reverse().map((e, i) => ({
        label: e.title?.slice(0, 20) || `Exam ${i + 1}`,
        score: e.percentage
      }))
    },
    fees: {
      status: feeStatus,
      totalDue: totalFeeDue,
      totalPaid: totalFeePaid,
      invoices: feeInvoices.slice(0, 8).map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        balanceAmount: inv.balanceAmount,
        totalAmount: inv.totalAmount,
        dueDate: inv.dueDate
      }))
    },
    transport: {
      route: 'Not assigned',
      busNumber: '—',
      pickupPoint: student.address?.line1 || '—'
    },
    behavior: {
      score: attendancePercentage >= 90 && averageScore >= 75 ? 'Excellent' : attendancePercentage >= 75 ? 'Good' : 'Needs attention',
      remarks: attendancePercentage < 75 ? 'Low attendance may affect learning outcomes' : 'Regular attendance maintained'
    }
  };

  if (classMates.length && examResults.length) {
    const mateIds = classMates.map((m) => m._id);
    const mateScores = await ExamSubmission.aggregate([
      { $match: { student: { $in: mateIds }, status: 'graded' } },
      { $group: { _id: '$student', avg: { $avg: '$percentage' } } },
      { $sort: { avg: -1 } }
    ]);
    const myRank = mateScores.filter((m) => m.avg > averageScore).length + 1;
    profilePayload.academic.classRank = `${myRank} / ${mateScores.length + 1}`;
  }

  const aiInsights = await analyzeStudentProfile(profilePayload);
  profilePayload.aiInsights = aiInsights;

  log.info('Student profile loaded', { studentId: student._id, user: req.user.email });
  res.json(profilePayload);
});
