const ClassRoom = require('../models/ClassRoom');
const ExamSubmission = require('../models/ExamSubmission');
const FeeInvoice = require('../models/FeeInvoice');
const Student = require('../models/Student');
const asyncHandler = require('../middleware/asyncHandler');
const { createLogger } = require('../utils/logger');
const {
  buildTransportCard,
  buildAttendanceCard,
  buildFeeSummary,
  buildActivityTimeline
} = require('../services/studentProfile.service');
const { HTTP_STATUS, ROLES, PAGINATION } = require('../constants');
const { maskStudentRecord } = require('../utils/dataMasking');

const log = createLogger('students');
const PERCENTAGE_MULTIPLIER = 100;
const MANDATORY_DOC_TYPES = ['photo', 'birth_certificate'];

function computeProfileCompletion(student, latestEnrollment) {
  const checks = [
    !!student.firstName,
    !!student.lastName,
    !!student.dateOfBirth,
    !!student.gender,
    !!student.address?.line1,
    !!student.address?.city,
    !!student.address?.state,
    !!student.address?.pincode,
    !!(student.guardians?.length && student.guardians[0]?.phone),
    !!(student.aadhaarNumber || student.guardians?.[0]?.phone),
    !!student.documents?.some((d) => d.type === 'photo'),
    !!student.documents?.some((d) => d.type === 'birth_certificate'),
    !!latestEnrollment?.classRoom,
    !!latestEnrollment?.rollNumber
  ];
  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * PERCENTAGE_MULTIPLIER);
}

function mandatoryDocumentStatus(documents = []) {
  const uploaded = MANDATORY_DOC_TYPES.filter((type) => documents.some((d) => d.type === type && d.fileUrl));
  return {
    photo: documents.some((d) => d.type === 'photo' && d.fileUrl) ? 'uploaded' : 'pending',
    birthCertificate: documents.some((d) => d.type === 'birth_certificate' && d.fileUrl) ? 'uploaded' : 'pending',
    overall: uploaded.length === MANDATORY_DOC_TYPES.length ? 'uploaded' : 'pending'
  };
}

async function assertStudentAccess(req, studentId) {
  if (req.user.role === ROLES.STUDENT && req.user.student?.toString() !== studentId) {
    return { error: 'Students can only access their own profile', status: HTTP_STATUS.FORBIDDEN };
  }
  if (req.user.role === ROLES.PARENT) {
    const childIds = (req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : [])).map(String);
    if (!childIds.includes(studentId)) return { error: 'Parents can only access their linked child profile', status: HTTP_STATUS.FORBIDDEN };
  }
  if (req.user.role === ROLES.TEACHER) {
    const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
    const student = await Student.findById(studentId).lean();
    if (!student) return { error: 'Student not found', status: HTTP_STATUS.NOT_FOUND };
    const canAccess = student.enrollments?.some((e) => classIds.some((id) => id.equals(e.classRoom)));
    if (!canAccess) return { error: 'Teacher can only access assigned class students', status: HTTP_STATUS.FORBIDDEN };
  }
  return null;
}

exports.getProfile = asyncHandler(async (req, res) => {
  const accessError = await assertStudentAccess(req, req.params.id);
  if (accessError) return res.status(accessError.status).json({ message: accessError.error });

  const student = await Student.findById(req.params.id)
    .populate('enrollments.academicYear', 'name isActive status')
    .populate('enrollments.classRoom', 'name section monthlyFee classTeacher')
    .populate('enrollments.classRoom.classTeacher', 'firstName lastName phone email');

  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const latestEnrollment = student.enrollments?.filter((e) => e.status === 'studying').pop()
    || student.enrollments?.[student.enrollments.length - 1];
  const academicYearId = latestEnrollment?.academicYear?._id || latestEnrollment?.academicYear;
  const classRoomId = latestEnrollment?.classRoom?._id || latestEnrollment?.classRoom;

  const [examSubmissions, feeInvoices, classMates, attendance, transport] = await Promise.all([
    ExamSubmission.find({ student: student._id, status: 'graded' })
      .populate({ path: 'exam', select: 'title subject chapter totalMarks classRoom', populate: { path: 'classRoom', select: 'name section' } })
      .sort({ submittedAt: -1 })
      .lean(),
    FeeInvoice.find({ student: student._id, ...(academicYearId ? { academicYear: academicYearId } : {}) })
      .sort({ feeYear: -1, feeMonth: -1, dueDate: -1 })
      .lean({ virtuals: true }),
    latestEnrollment?.classRoom
      ? Student.find({
          _id: { $ne: student._id },
          'enrollments.classRoom': latestEnrollment.classRoom._id || latestEnrollment.classRoom,
          'enrollments.status': 'studying',
          status: 'active'
        }).select('_id').lean()
      : Promise.resolve([]),
    buildAttendanceCard(student._id, academicYearId),
    buildTransportCard(student, academicYearId)
  ]);

  const [fees, activityTimeline] = await Promise.all([
    buildFeeSummary(student, academicYearId, classRoomId, feeInvoices),
    buildActivityTimeline(student, feeInvoices, academicYearId)
  ]);

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

  const photoDoc = student.documents?.find((d) => d.type === 'photo');
  const docStatus = mandatoryDocumentStatus(student.documents);

  const profilePayload = {
    student: maskStudentRecord({
      _id: student._id,
      admissionNumber: student.admissionNumber,
      firstName: student.firstName,
      lastName: student.lastName,
      gender: student.gender,
      dateOfBirth: student.dateOfBirth,
      bloodGroup: student.bloodGroup,
      category: student.category,
      nationality: student.nationality,
      motherName: student.motherName,
      aadhaarNumber: student.aadhaarNumber,
      udisePenId: student.udisePenId,
      status: student.status,
      admissionDate: student.admissionDate,
      updatedAt: student.updatedAt,
      createdBy: student.createdBy,
      updatedBy: student.updatedBy,
      address: student.address,
      guardians: student.guardians,
      photoUrl: photoDoc?.fileUrl || null
    }, req.user, req.permissions),
    academic: {
      className: latestEnrollment?.classRoom
        ? `${latestEnrollment.classRoom.name}-${latestEnrollment.classRoom.section}`
        : 'Unassigned',
      classRoom: latestEnrollment?.classRoom,
      academicYear: latestEnrollment?.academicYear,
      rollNumber: latestEnrollment?.rollNumber || '—',
      classTeacher: latestEnrollment?.classRoom?.classTeacher || null,
      classRank: null,
      admissionDate: student.admissionDate,
      lastUpdated: student.updatedAt
    },
    documents: {
      items: (student.documents || []).map((d) => ({
        _id: d._id,
        type: d.type,
        title: d.title,
        status: d.fileUrl ? 'uploaded' : 'pending',
        verificationStatus: d.status,
        uploadedAt: d.uploadedAt
      })),
      mandatoryStatus: docStatus
    },
    profileCompletion: computeProfileCompletion(student, latestEnrollment),
    activityTimeline,
    attendance,
    academics: {
      averageScore,
      examCount: examResults.length,
      examResults: examResults.slice(0, PAGINATION.MAX_EXAM_RESULTS),
      subjectBreakdown,
      performanceTrend: examResults.slice(0, PAGINATION.MAX_TREND_ITEMS).reverse().map((e, i) => ({
        label: e.title?.slice(0, 20) || `Exam ${i + 1}`,
        score: e.percentage
      }))
    },
    fees,
    transport,
    behavior: {
      score: attendance.percentage >= 90 && averageScore >= 75 ? 'Excellent' : attendance.percentage >= 75 ? 'Good' : 'Needs attention',
      remarks: attendance.percentage < 75 ? 'Low attendance may affect learning outcomes' : 'Regular attendance maintained'
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

  log.info('Student profile loaded', { studentId: student._id, user: req.user.email });
  res.json(profilePayload);
});
