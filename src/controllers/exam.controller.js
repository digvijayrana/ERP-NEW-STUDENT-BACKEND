const Exam = require('../models/Exam');
const ExamSubmission = require('../models/ExamSubmission');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const asyncHandler = require('../middleware/asyncHandler');
const { createLogger } = require('../utils/logger');
const { generateExamQuestions, gradeAnswer, calculateGrade } = require('../services/aiQuestion.service');
const { HTTP_STATUS, ROLES, EXAM } = require('../constants');

const log = createLogger('exams');
const PERCENTAGE_MULTIPLIER = 100;

async function teacherClassIds(req) {
  if (req.user.role !== ROLES.TEACHER) return null;
  return ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
}

async function accessibleClassFilter(req) {
  const classIds = await teacherClassIds(req);
  if (classIds) return { classRoom: { $in: classIds } };
  if (req.user.role === ROLES.STUDENT) {
    const student = await Student.findById(req.user.student).lean();
    const enrolledClassIds = (student?.enrollments || [])
      .filter((e) => e.status === 'studying')
      .map((e) => e.classRoom);
    return { classRoom: { $in: enrolledClassIds }, status: 'published' };
  }
  if (req.user.role === ROLES.PARENT && req.user.linkedStudent) {
    const student = await Student.findById(req.user.linkedStudent).lean();
    const enrolledClassIds = (student?.enrollments || [])
      .filter((e) => e.status === 'studying')
      .map((e) => e.classRoom);
    return { classRoom: { $in: enrolledClassIds }, status: { $in: ['published', 'closed'] } };
  }
  return {};
}

function stripAnswers(exam) {
  const doc = exam.toObject ? exam.toObject() : exam;
  return {
    ...doc,
    questions: (doc.questions || []).map(({ correctAnswer, explanation, ...rest }) => rest)
  };
}

exports.list = asyncHandler(async (req, res) => {
  const filter = await accessibleClassFilter(req);
  const exams = await Exam.find(filter)
    .populate('classRoom', 'name section')
    .populate('academicYear', 'name')
    .populate('createdBy', 'firstName lastName')
    .sort({ createdAt: -1 });

  const payload = req.user.role === ROLES.STUDENT || req.user.role === ROLES.PARENT
    ? exams.map(stripAnswers)
    : exams;

  log.info('Exam list fetched', { user: req.user.email, count: payload.length });
  res.json(payload);
});

exports.getById = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id)
    .populate('classRoom', 'name section')
    .populate('academicYear', 'name')
    .populate('createdBy', 'firstName lastName');

  if (!exam) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Exam not found' });

  const filter = await accessibleClassFilter(req);
  if (filter.classRoom && !filter.classRoom.$in?.map(String).includes(String(exam.classRoom._id || exam.classRoom))) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'You do not have access to this exam' });
  }

  if (req.user.role === ROLES.STUDENT || req.user.role === ROLES.PARENT) {
    return res.json(stripAnswers(exam));
  }

  res.json(exam);
});

exports.generate = asyncHandler(async (req, res) => {
  const {
    title,
    subject,
    chapter,
    bookReference,
    additionalContext,
    classRoom,
    academicYear,
    difficulty = 'medium',
    questionCount = EXAM.DEFAULT_QUESTION_COUNT,
    durationMinutes = EXAM.DEFAULT_DURATION_MINUTES
  } = req.body;

  if (!title || !subject || !chapter || !classRoom || !academicYear) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'title, subject, chapter, classRoom, and academicYear are required' });
  }

  const allowedClassIds = await teacherClassIds(req);
  if (allowedClassIds && !allowedClassIds.map(String).includes(String(classRoom))) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Teacher can create exams only for assigned classes' });
  }

  log.info('Generating exam questions', {
    teacher: req.user.email,
    subject,
    chapter,
    difficulty,
    questionCount
  });

  const { questions, aiGenerated, provider } = await generateExamQuestions({
    subject,
    chapter,
    bookReference,
    additionalContext,
    difficulty,
    questionCount: Number(questionCount)
  });

  const exam = await Exam.create({
    title,
    subject,
    chapter,
    bookReference,
    additionalContext,
    classRoom,
    academicYear,
    createdBy: req.user.role === ROLES.TEACHER ? req.user.teacher : undefined,
    difficulty,
    questionCount: questions.length,
    durationMinutes,
    questions,
    aiGenerated,
    status: 'draft'
  });

  log.info('Exam draft created with AI questions', {
    examId: exam._id,
    questionCount: questions.length,
    provider,
    aiGenerated
  });

  res.status(HTTP_STATUS.CREATED).json(exam);
});

exports.update = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Exam not found' });

  const allowedClassIds = await teacherClassIds(req);
  if (allowedClassIds && !allowedClassIds.map(String).includes(String(exam.classRoom))) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'You cannot edit this exam' });
  }

  const allowedFields = ['title', 'subject', 'chapter', 'bookReference', 'additionalContext', 'difficulty', 'durationMinutes', 'questions', 'scheduledAt', 'closesAt', 'status'];
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) exam[field] = req.body[field];
  });

  await exam.save();
  log.info('Exam updated', { examId: exam._id, status: exam.status, user: req.user.email });
  res.json(exam);
});

exports.publish = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Exam not found' });
  if (!exam.questions.length) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Cannot publish an exam without questions' });

  exam.status = 'published';
  exam.scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : new Date();
  exam.closesAt = req.body.closesAt ? new Date(req.body.closesAt) : undefined;
  await exam.save();

  log.info('Exam published for students', { examId: exam._id, classRoom: exam.classRoom, user: req.user.email });
  res.json(exam);
});

exports.close = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Exam not found' });
  exam.status = 'closed';
  exam.closesAt = new Date();
  await exam.save();
  log.info('Exam closed', { examId: exam._id, user: req.user.email });
  res.json(exam);
});

exports.startAttempt = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.STUDENT) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Only students can attempt exams' });
  }

  const exam = await Exam.findById(req.params.id);
  if (!exam || exam.status !== 'published') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Exam is not available for attempt' });
  }

  if (exam.closesAt && new Date() > new Date(exam.closesAt)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Exam submission window has closed' });
  }

  let submission = await ExamSubmission.findOne({ exam: exam._id, student: req.user.student });
  if (submission && submission.status !== 'in_progress') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'You have already submitted this exam' });
  }

  if (!submission) {
    submission = await ExamSubmission.create({
      exam: exam._id,
      student: req.user.student,
      maxScore: exam.totalMarks,
      answers: exam.questions.map((q) => ({ questionId: q._id, answer: '' })),
      status: 'in_progress'
    });
    log.info('Student started exam attempt', { examId: exam._id, studentId: req.user.student });
  }

  res.json({ submission, exam: stripAnswers(exam) });
});

exports.submitAttempt = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.STUDENT) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Only students can submit exams' });
  }

  const exam = await Exam.findById(req.params.id);
  if (!exam) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Exam not found' });

  const submission = await ExamSubmission.findOne({ exam: exam._id, student: req.user.student });
  if (!submission || submission.status !== 'in_progress') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'No active exam attempt found' });
  }

  const answerMap = new Map((req.body.answers || []).map((a) => [String(a.questionId), a.answer]));
  let score = 0;

  submission.answers = exam.questions.map((question) => {
    const answer = answerMap.get(String(question._id)) || '';
    const result = gradeAnswer(question, answer);
    score += result.marksAwarded;
    return {
      questionId: question._id,
      answer,
      isCorrect: result.isCorrect,
      marksAwarded: result.marksAwarded
    };
  });

  submission.score = score;
  submission.maxScore = exam.totalMarks;
  submission.percentage = exam.totalMarks ? Math.round((score / exam.totalMarks) * PERCENTAGE_MULTIPLIER) : 0;
  submission.grade = calculateGrade(submission.percentage);
  submission.status = 'graded';
  submission.submittedAt = new Date();
  submission.gradedBy = 'auto';
  await submission.save();

  log.info('Exam submitted and auto-graded', {
    examId: exam._id,
    studentId: req.user.student,
    score,
    percentage: submission.percentage,
    grade: submission.grade
  });

  res.json(submission);
});

exports.results = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.exam) filter.exam = req.query.exam;

  if (req.user.role === ROLES.STUDENT) {
    filter.student = req.user.student;
  } else if (req.user.role === ROLES.PARENT && req.user.linkedStudent) {
    filter.student = req.user.linkedStudent;
  } else if (req.user.role === ROLES.TEACHER) {
    const classIds = await teacherClassIds(req);
    const examIds = await Exam.find({ classRoom: { $in: classIds } }).distinct('_id');
    filter.exam = filter.exam || { $in: examIds };
  }

  const submissions = await ExamSubmission.find(filter)
    .populate('student', 'firstName lastName admissionNumber')
    .populate({
      path: 'exam',
      select: 'title subject chapter classRoom academicYear totalMarks',
      populate: [
        { path: 'classRoom', select: 'name section' },
        { path: 'academicYear', select: 'name' }
      ]
    })
    .sort({ submittedAt: -1 });

  log.info('Exam results fetched', { user: req.user.email, count: submissions.length });
  res.json(submissions);
});

exports.classReport = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id).populate('classRoom', 'name section');
  if (!exam) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Exam not found' });

  const submissions = await ExamSubmission.find({ exam: exam._id, status: 'graded' })
    .populate('student', 'firstName lastName admissionNumber')
    .lean();

  const attempted = submissions.length;
  const averageScore = attempted
    ? Math.round(submissions.reduce((sum, s) => sum + s.percentage, 0) / attempted)
    : 0;
  const passCount = submissions.filter((s) => s.percentage >= EXAM.PASS_PERCENTAGE).length;

  log.info('Class exam report generated', { examId: exam._id, attempted, averageScore, user: req.user.email });

  res.json({
    exam,
    summary: {
      attempted,
      averageScore,
      passRate: attempted ? Math.round((passCount / attempted) * PERCENTAGE_MULTIPLIER) : 0,
      highestScore: attempted ? Math.max(...submissions.map((s) => s.percentage)) : 0,
      lowestScore: attempted ? Math.min(...submissions.map((s) => s.percentage)) : 0
    },
    submissions
  });
});

exports.deleteExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Exam not found' });
  if (exam.status === 'published') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Close the exam before deleting' });
  }
  await ExamSubmission.deleteMany({ exam: exam._id });
  await exam.deleteOne();
  log.warn('Exam deleted', { examId: req.params.id, user: req.user.email });
  res.json({ deleted: true });
});
