const Attendance = require('../models/Attendance');
const ExamSubmission = require('../models/ExamSubmission');
const FeeInvoice = require('../models/FeeInvoice');
const Student = require('../models/Student');
const ClassRoom = require('../models/ClassRoom');
const PromotionBatch = require('../models/PromotionBatch');
const scoringConfig = require('../config/aiScoring.config');
const { createLogger } = require('../utils/logger');
const { recordActivity } = require('./activityLog.service');

const log = createLogger('ai-insights');
const PRESENT_STATUSES = new Set(['present', 'late', 'half_day']);
const AI_MODULE = 'ai_insights';

function studentLabel(student) {
  return [student?.firstName, student?.lastName].filter(Boolean).join(' ');
}

function monthRange(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function previousMonth(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function classifyBand(score, bands) {
  const match = bands.find((band) => score >= band.min);
  return match || bands[bands.length - 1];
}

function trendDirection(current, previous, higherIsBetter = true, tolerance = 2) {
  const diff = current - previous;
  if (Math.abs(diff) <= tolerance) return 'stable';
  if (higherIsBetter) return diff > 0 ? 'improved' : 'declined';
  return diff < 0 ? 'improved' : 'declined';
}

function getStudyingEnrollment(student, academicYearId) {
  return (student.enrollments || []).find(
    (entry) =>
      String(entry.academicYear) === String(academicYearId) &&
      entry.status === 'studying'
  );
}

async function attendanceMetrics(studentId, academicYearId, range) {
  const filter = { student: studentId };
  if (academicYearId) filter.academicYear = academicYearId;
  if (range) filter.date = { $gte: range.start, $lte: range.end };

  const records = await Attendance.find(filter).select('status date').lean();
  const present = records.filter((row) => PRESENT_STATUSES.has(row.status)).length;
  const absent = records.filter((row) => row.status === 'absent').length;
  const leave = records.filter((row) => row.status === 'leave').length;
  const countable = present + absent + leave;
  const percentage = countable ? Math.round((present / countable) * 100) : 100;

  return { present, absent, leave, total: records.length, percentage, records };
}

async function examinationMetrics(studentId) {
  const submissions = await ExamSubmission.find({ student: studentId, status: 'graded' })
    .select('percentage subject score maxScore submittedAt')
    .lean();

  const averageScore = submissions.length
    ? Math.round(submissions.reduce((sum, row) => sum + (row.percentage || 0), 0) / submissions.length)
    : 0;

  const subjectMap = new Map();
  submissions.forEach((row) => {
    if (!row.subject) return;
    const bucket = subjectMap.get(row.subject) || { total: 0, count: 0 };
    bucket.total += row.percentage || 0;
    bucket.count += 1;
    subjectMap.set(row.subject, bucket);
  });

  const weakSubjects = [...subjectMap.entries()]
    .filter(([, data]) => data.total / data.count < scoringConfig.thresholds.poorExamAverage)
    .map(([subject]) => subject);

  return { submissions, averageScore, weakSubjects, attemptCount: submissions.length };
}

async function feeMetrics(studentId, academicYearId) {
  const filter = { student: studentId, status: { $ne: 'cancelled' } };
  if (academicYearId) filter.academicYear = academicYearId;

  const invoices = await FeeInvoice.find(filter).lean({ virtuals: true });
  let pending = 0;
  let paid = 0;
  let overdue = 0;
  const now = new Date();

  for (const invoice of invoices) {
    pending += invoice.balanceAmount || 0;
    paid += invoice.paidAmount || 0;
    if (invoice.balanceAmount > 0 && invoice.dueDate && new Date(invoice.dueDate) < now) overdue += 1;
  }

  let regularityScore = 100;
  if (pending > 0 && paid === 0) regularityScore = 25;
  else if (overdue > 0) regularityScore = 35;
  else if (pending > 0) regularityScore = 60;

  return {
    pending,
    paid,
    overdueCount: overdue,
    status: pending <= 0 ? 'paid' : overdue > 0 ? 'overdue' : invoices.some((i) => i.status === 'partial') ? 'partial' : 'unpaid',
    regularityScore
  };
}

function behaviourScore(attendancePercentage, examAverage) {
  if (attendancePercentage >= 90 && examAverage >= 75) return 95;
  if (attendancePercentage >= 80 && examAverage >= 60) return 80;
  if (attendancePercentage >= 70) return 65;
  return 45;
}

function assignmentScore(examMetrics) {
  if (!examMetrics.attemptCount) return 55;
  return Math.min(100, Math.round(examMetrics.averageScore * 0.7 + Math.min(examMetrics.attemptCount, 10) * 3));
}

function buildStudentRecommendations({ weakSubjects, attendance, fees, examMetrics, performanceBand }) {
  const recommendations = [];

  weakSubjects.forEach((subject) => {
    recommendations.push({
      code: 'SUBJECT_PRACTICE',
      message: `Needs ${subject} practice`,
      priority: 'medium'
    });
  });

  if (attendance.percentage < scoringConfig.thresholds.lowAttendance) {
    recommendations.push({
      code: 'ATTENDANCE_IMPROVEMENT',
      message: 'Attendance improvement required',
      priority: 'high'
    });
  }

  if (performanceBand.key === 'excellent') {
    recommendations.push({
      code: 'ACADEMIC_EXCELLENCE',
      message: 'Eligible for academic excellence recognition',
      priority: 'low'
    });
  }

  if (fees.pending > 0 || fees.overdueCount > 0) {
    recommendations.push({
      code: 'FEE_FOLLOWUP',
      message: 'Fee follow-up required',
      priority: fees.overdueCount > 0 ? 'high' : 'medium'
    });
  }

  if (examMetrics.attemptCount >= 3 && examMetrics.averageScore >= 70) {
    recommendations.push({
      code: 'REGULAR_PARTICIPATION',
      message: 'Regular participation recommended — maintain momentum',
      priority: 'low'
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      code: 'MAINTAIN_PERFORMANCE',
      message: 'Continue current study routine and monitor progress',
      priority: 'low'
    });
  }

  return recommendations;
}

function buildTeacherRecommendations(studentInsight) {
  const items = [];
  const { riskLevel, performanceBand, recommendations, studentName, admissionNumber, weakSubjects, attendance, fees } = studentInsight;

  if (riskLevel.key === 'high' || performanceBand.key === 'needs_attention') {
    items.push({ code: 'EXTRA_COACHING', message: 'Students requiring extra coaching', studentName, admissionNumber });
  }

  if (attendance.percentage < scoringConfig.thresholds.lowAttendance) {
    items.push({ code: 'PARENT_MEETING', message: 'Parent meeting recommended', studentName, admissionNumber });
  }

  if (riskLevel.key === 'high') {
    items.push({ code: 'COUNSELLING', message: 'Counselling recommended', studentName, admissionNumber });
  }

  if (weakSubjects.length) {
    items.push({ code: 'EXAM_REVISION', message: 'Examination revision required', studentName, admissionNumber, subjects: weakSubjects });
  }

  if (fees.pending > 0) {
    items.push({ code: 'FEE_FOLLOWUP', message: 'Fee follow-up with guardians', studentName, admissionNumber });
  }

  if (!items.length && recommendations.length) {
    items.push({ code: 'MONITOR', message: 'Monitor progress and provide encouragement', studentName, admissionNumber });
  }

  return items;
}

function computeRiskScore({ attendance, examMetrics, fees, attendanceTrendDelta, monthlyAbsences }) {
  let riskScore = 100;
  const factors = [];

  if (examMetrics.averageScore < scoringConfig.thresholds.poorExamAverage) {
    riskScore -= scoringConfig.riskPenalties.poorExamResults;
    factors.push('Poor examination results');
  }

  if (attendance.percentage < scoringConfig.thresholds.lowAttendance) {
    riskScore -= scoringConfig.riskPenalties.decliningAttendance;
    factors.push('Low attendance');
  }

  if (attendanceTrendDelta <= -scoringConfig.thresholds.decliningAttendanceDelta) {
    riskScore -= scoringConfig.riskPenalties.decliningAttendance;
    factors.push('Declining attendance trend');
  }

  if (monthlyAbsences >= scoringConfig.thresholds.repeatedAbsencesPerMonth) {
    riskScore -= scoringConfig.riskPenalties.repeatedAbsences;
    factors.push('Repeated absences');
  }

  if (fees.pending > 0) {
    riskScore -= scoringConfig.riskPenalties.unpaidFees;
    factors.push(fees.overdueCount > 0 ? 'Overdue fees' : 'Pending fees');
  }

  riskScore = Math.max(0, Math.min(100, riskScore));
  const riskLevel = classifyBand(riskScore, scoringConfig.riskBands);

  return { riskScore, riskLevel, riskFactors: factors };
}

async function buildStudentInsight(student, academicYearId) {
  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const prev = previousMonth(current.year, current.month);
  const currentRange = monthRange(current.year, current.month);
  const previousRange = monthRange(prev.year, prev.month);

  const [attendanceAll, attendanceCurrent, attendancePrevious, examMetrics, fees] = await Promise.all([
    attendanceMetrics(student._id, academicYearId),
    attendanceMetrics(student._id, academicYearId, currentRange),
    attendanceMetrics(student._id, academicYearId, previousRange),
    examinationMetrics(student._id),
    feeMetrics(student._id, academicYearId)
  ]);

  const attendanceTrendDelta = attendanceCurrent.percentage - attendancePrevious.percentage;
  const behaviour = behaviourScore(attendanceAll.percentage, examMetrics.averageScore);
  const assignment = assignmentScore(examMetrics);

  const components = {
    attendance: attendanceAll.percentage,
    examination: examMetrics.averageScore,
    assignment,
    feeRegularity: fees.regularityScore,
    behaviour
  };

  const weights = scoringConfig.weights;
  const performanceScore = Math.round(
    components.attendance * weights.attendance +
    components.examination * weights.examination +
    components.assignment * weights.assignment +
    components.feeRegularity * weights.feeRegularity +
    components.behaviour * weights.behaviour
  );

  const performanceBand = classifyBand(performanceScore, scoringConfig.performanceBands);
  const { riskScore, riskLevel, riskFactors } = computeRiskScore({
    attendance: attendanceAll,
    examMetrics,
    fees,
    attendanceTrendDelta,
    monthlyAbsences: attendanceCurrent.absent
  });

  const recommendations = buildStudentRecommendations({
    weakSubjects: examMetrics.weakSubjects,
    attendance: attendanceAll,
    fees,
    examMetrics,
    performanceBand
  });

  return {
    studentId: student._id,
    admissionNumber: student.admissionNumber,
    studentName: studentLabel(student),
    performanceScore,
    performanceBand,
    performanceRating: performanceBand.key,
    riskScore,
    riskLevel,
    riskFactors,
    components,
    attendance: attendanceAll,
    examMetrics,
    fees,
    recommendations,
    teacherRecommendations: buildTeacherRecommendations({
      riskLevel,
      performanceBand,
      recommendations,
      studentName: studentLabel(student),
      admissionNumber: student.admissionNumber,
      weakSubjects: examMetrics.weakSubjects,
      attendance: attendanceAll,
      fees
    })
  };
}

async function buildStudentInsightFromProfile(profile) {
  const student = { _id: profile.student._id, firstName: profile.student.firstName, lastName: profile.student.lastName, admissionNumber: profile.student.admissionNumber };
  const academicYearId = profile.academic?.academicYear?._id || profile.academic?.academicYear;

  const attendance = {
    percentage: profile.attendance?.percentage || 0,
    absent: profile.attendance?.absent || 0,
    present: profile.attendance?.present || 0,
    total: profile.attendance?.total || 0
  };

  const examMetrics = {
    averageScore: profile.academics?.averageScore || 0,
    weakSubjects: (profile.academics?.subjectBreakdown || [])
      .filter((row) => row.average < scoringConfig.thresholds.poorExamAverage)
      .map((row) => row.subject),
    attemptCount: profile.academics?.examCount || 0
  };

  const fees = {
    pending: profile.fees?.pendingAmount ?? profile.fees?.totalDue ?? 0,
    paid: profile.fees?.totalPaid || 0,
    overdueCount: (profile.fees?.invoices || []).filter((inv) => inv.balanceAmount > 0 && inv.dueDate && new Date(inv.dueDate) < new Date()).length,
    status: profile.fees?.status || 'unknown',
    regularityScore: profile.fees?.totalDue > 0 ? (profile.fees?.status === 'paid' ? 100 : 50) : 100
  };

  const behaviour = behaviourScore(attendance.percentage, examMetrics.averageScore);
  const assignment = assignmentScore(examMetrics);
  const components = {
    attendance: attendance.percentage,
    examination: examMetrics.averageScore,
    assignment,
    feeRegularity: fees.regularityScore,
    behaviour
  };

  const weights = scoringConfig.weights;
  const performanceScore = Math.round(
    components.attendance * weights.attendance +
    components.examination * weights.examination +
    components.assignment * weights.assignment +
    components.feeRegularity * weights.feeRegularity +
    components.behaviour * weights.behaviour
  );

  const performanceBand = classifyBand(performanceScore, scoringConfig.performanceBands);
  const { riskScore, riskLevel, riskFactors } = computeRiskScore({
    attendance,
    examMetrics,
    fees,
    attendanceTrendDelta: 0,
    monthlyAbsences: attendance.absent
  });

  const recommendations = buildStudentRecommendations({
    weakSubjects: examMetrics.weakSubjects,
    attendance,
    fees,
    examMetrics,
    performanceBand
  });

  return {
    performanceScore,
    performanceRating: performanceBand.key,
    performanceBand,
    riskScore,
    riskLevel,
    riskFactors,
    components,
    recommendations,
    teacherRecommendations: buildTeacherRecommendations({
      riskLevel,
      performanceBand,
      recommendations,
      studentName: studentLabel(student),
      admissionNumber: student.admissionNumber,
      weakSubjects: examMetrics.weakSubjects,
      attendance,
      fees
    })
  };
}

async function listScopedStudents(activeYear, teacherId) {
  const filter = { status: 'active' };
  if (activeYear?._id) {
    filter.enrollments = {
      $elemMatch: { academicYear: activeYear._id, status: 'studying' }
    };
  }

  if (teacherId) {
    const classIds = await ClassRoom.find({ classTeacher: teacherId, status: 'active' }).distinct('_id');
    filter.enrollments = {
      $elemMatch: {
        academicYear: activeYear?._id,
        status: 'studying',
        classRoom: { $in: classIds }
      }
    };
  }

  return Student.find(filter).select('admissionNumber firstName lastName enrollments').lean();
}

async function monthlyAttendanceRate(academicYearId, year, month) {
  const range = monthRange(year, month);
  const filter = { date: { $gte: range.start, $lte: range.end } };
  if (academicYearId) filter.academicYear = academicYearId;
  const records = await Attendance.find(filter).select('status').lean();
  if (!records.length) return 0;
  const present = records.filter((row) => PRESENT_STATUSES.has(row.status)).length;
  const countable = records.filter((row) => ['present', 'absent', 'leave', 'late', 'half_day'].includes(row.status)).length;
  return countable ? Math.round((present / countable) * 100) : 0;
}

async function monthlyFeeRecovery(academicYearId, year, month) {
  const range = monthRange(year, month);
  const filter = { status: { $ne: 'cancelled' } };
  if (academicYearId) filter.academicYear = academicYearId;
  const invoices = await FeeInvoice.find(filter).lean({ virtuals: true });

  let collected = 0;
  let due = 0;
  for (const invoice of invoices) {
    due += invoice.totalAmount || 0;
    for (const payment of invoice.payments || []) {
      if (payment.status === 'void' || !payment.paidAt) continue;
      const paidAt = new Date(payment.paidAt);
      if (paidAt >= range.start && paidAt <= range.end) collected += payment.amount || 0;
    }
  }

  return due > 0 ? Math.round((collected / due) * 100) : (collected > 0 ? 100 : 0);
}

async function monthlyAcademicAverage(year, month) {
  const range = monthRange(year, month);
  const submissions = await ExamSubmission.find({
    status: 'graded',
    submittedAt: { $gte: range.start, $lte: range.end }
  }).select('percentage').lean();
  if (!submissions.length) return 0;
  return Math.round(submissions.reduce((sum, row) => sum + (row.percentage || 0), 0) / submissions.length);
}

async function monthlyPromotionSuccess(academicYearId, year, month) {
  const range = monthRange(year, month);
  const filter = {
    status: 'finalized',
    finalizedAt: { $gte: range.start, $lte: range.end }
  };
  if (academicYearId) filter.fromAcademicYear = academicYearId;
  const batches = await PromotionBatch.find(filter).select('promotedCount students').lean();
  const promoted = batches.reduce((sum, batch) => sum + (batch.promotedCount || 0), 0);
  const total = batches.reduce((sum, batch) => sum + (batch.students?.length || 0), 0);
  return total > 0 ? Math.round((promoted / total) * 100) : (promoted > 0 ? 100 : 0);
}

async function monthlyRiskIndex(academicYearId, year, month) {
  const [attendanceRate, academicAvg] = await Promise.all([
    monthlyAttendanceRate(academicYearId, year, month),
    monthlyAcademicAverage(year, month)
  ]);
  return Math.round(((100 - attendanceRate) + (100 - academicAvg)) / 2);
}

async function buildTrendAnalysis(activeYear) {
  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const prev = previousMonth(current.year, current.month);
  const yearId = activeYear?._id;

  const [attendanceCurrent, attendancePrevious, academicCurrent, academicPrevious, feeCurrent, feePrevious, promotionCurrent, promotionPrevious, riskCurrent, riskPrevious] = await Promise.all([
    monthlyAttendanceRate(yearId, current.year, current.month),
    monthlyAttendanceRate(yearId, prev.year, prev.month),
    monthlyAcademicAverage(current.year, current.month),
    monthlyAcademicAverage(prev.year, prev.month),
    monthlyFeeRecovery(yearId, current.year, current.month),
    monthlyFeeRecovery(yearId, prev.year, prev.month),
    monthlyPromotionSuccess(yearId, current.year, current.month),
    monthlyPromotionSuccess(yearId, prev.year, prev.month),
    monthlyRiskIndex(yearId, current.year, current.month),
    monthlyRiskIndex(yearId, prev.year, prev.month)
  ]);

  return [
    {
      metric: 'attendance',
      label: 'Attendance',
      currentValue: attendanceCurrent,
      previousValue: attendancePrevious,
      trend: trendDirection(attendanceCurrent, attendancePrevious, true)
    },
    {
      metric: 'academic_performance',
      label: 'Academic Performance',
      currentValue: academicCurrent,
      previousValue: academicPrevious,
      trend: trendDirection(academicCurrent, academicPrevious, true)
    },
    {
      metric: 'fee_recovery',
      label: 'Fee Recovery',
      currentValue: feeCurrent,
      previousValue: feePrevious,
      trend: trendDirection(feeCurrent, feePrevious, true)
    },
    {
      metric: 'promotion_success',
      label: 'Promotion Success',
      currentValue: promotionCurrent,
      previousValue: promotionPrevious,
      trend: trendDirection(promotionCurrent, promotionPrevious, true)
    },
    {
      metric: 'student_risk',
      label: 'Student Risk Levels',
      currentValue: riskCurrent,
      previousValue: riskPrevious,
      trend: trendDirection(riskCurrent, riskPrevious, false)
    }
  ];
}

async function buildManagementInsights(activeYear, teacherId, user) {
  const students = await listScopedStudents(activeYear, teacherId);
  const insights = [];

  for (const student of students.slice(0, 200)) {
    insights.push(await buildStudentInsight(student, activeYear?._id));
  }

  const studentsAtRisk = insights
    .filter((row) => row.riskLevel.key === 'high' || row.riskLevel.key === 'medium')
    .sort((a, b) => a.riskScore - b.riskScore)
    .slice(0, 10);

  const topPerformers = insights
    .filter((row) => row.performanceBand.key === 'excellent' || row.performanceBand.key === 'good')
    .sort((a, b) => b.performanceScore - a.performanceScore)
    .slice(0, 10);

  const teacherRecommendations = teacherId
    ? insights.flatMap((row) => row.teacherRecommendations).slice(0, 20)
    : [];

  const trends = await buildTrendAnalysis(activeYear);
  const promotionTrend = trends.find((row) => row.metric === 'promotion_success');

  const payload = {
    generatedAt: new Date(),
    studentsAtRisk,
    topPerformers,
    teacherRecommendations,
    trends,
    summary: {
      totalAnalyzed: insights.length,
      atRiskCount: insights.filter((row) => row.riskLevel.key !== 'low').length,
      excellentCount: insights.filter((row) => row.performanceBand.key === 'excellent').length,
      promotionSuccessRate: promotionTrend?.currentValue || 0
    },
    attendanceTrend: trends.find((row) => row.metric === 'attendance'),
    feeRecoveryTrend: trends.find((row) => row.metric === 'fee_recovery'),
    promotionSuccessRate: promotionTrend?.currentValue || 0
  };

  recordActivity({
    module: AI_MODULE,
    entityLabel: 'management-insights',
    action: 'ai_insights_generated',
    description: `AI management insights generated for ${insights.length} students`,
    user,
    meta: { totalAnalyzed: insights.length, atRiskCount: payload.summary.atRiskCount }
  });

  log.info('Management insights generated', { students: insights.length, teacherId: teacherId || 'all' });
  return payload;
}

async function getStudentInsights(studentId, academicYearId, user) {
  const student = await Student.findById(studentId).lean();
  if (!student) return null;
  const insight = await buildStudentInsight(student, academicYearId);

  recordActivity({
    module: AI_MODULE,
    entityId: studentId,
    entityLabel: student.admissionNumber,
    action: 'ai_student_insights',
    description: `AI insights generated for ${student.admissionNumber}`,
    user,
    meta: { performanceScore: insight.performanceScore, riskLevel: insight.riskLevel.key }
  });

  return insight;
}

module.exports = {
  buildStudentInsight,
  buildStudentInsightFromProfile,
  buildManagementInsights,
  buildTrendAnalysis,
  getStudentInsights,
  buildStudentRecommendations,
  buildTeacherRecommendations,
  listScopedStudents
};
