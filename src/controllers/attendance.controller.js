const Attendance = require('../models/Attendance');
const TeacherAttendance = require('../models/TeacherAttendance');
const Student = require('../models/Student');
const asyncHandler = require('../middleware/asyncHandler');
const { logEntityUpdate } = require('../services/activityLog.service');
const {
  isBlockedDate,
  teacherClassIds,
  isFutureDate,
  startOfDay,
  loadRegisterSheet,
  saveRegisterDraft,
  submitRegister,
  lockRegister,
  unlockRegister,
  studentAttendanceSummary,
  buildReport
} = require('../services/attendance.service');
const { attendanceReportPdf } = require('../services/pdf.service');
const { HTTP_STATUS, ROLES, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');

const ATTENDANCE_SORT_FIELDS = ['date', 'status', 'createdAt'];

const ATTENDANCE_MODULE = 'attendance';

function logAttendanceActivity({ action, description, user, entityId, entityLabel, meta }) {
  logEntityUpdate({
    module: ATTENDANCE_MODULE,
    entityId,
    entityLabel,
    action,
    description,
    user,
    meta
  });
}

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.student) filter.student = req.query.student;
  if (req.query.classRoom) filter.classRoom = req.query.classRoom;
  if (req.query.academicYear) filter.academicYear = req.query.academicYear;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.date) filter.date = startOfDay(req.query.date);
  if (req.user.role === ROLES.STUDENT) filter.student = req.user.student;
  if (req.user.role === ROLES.PARENT) {
    const childIds = req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : []);
    const selectedChild = req.query.student && childIds.map(String).includes(String(req.query.student)) ? req.query.student : null;
    filter.student = selectedChild || { $in: childIds };
  }

  if (req.query.search) {
    const term = req.query.search.trim();
    const regex = new RegExp(term, 'i');
    const students = await Student.find({
      $or: [{ admissionNumber: regex }, { firstName: regex }, { lastName: regex }]
    }).distinct('_id');
    filter.$or = [{ status: regex }, { student: { $in: students } }];
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, ATTENDANCE_SORT_FIELDS, 'date');

  const [records, totalItems] = await Promise.all([
    Attendance.find(filter)
      .populate('student', 'firstName lastName admissionNumber')
      .populate('classRoom', 'name section')
      .populate('markedBy', 'firstName lastName')
      .populate('register', 'workflowStatus')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    Attendance.countDocuments(filter)
  ]);

  return sendPaginated(res, records, { page, pageSize, totalItems });
});

exports.getRegister = asyncHandler(async (req, res) => {
  const { academicYear, classRoom, date } = req.query;
  if (!academicYear || !classRoom || !date) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'academicYear, classRoom, and date are required' });
  }
  const sheet = await loadRegisterSheet({
    academicYearId: academicYear,
    classRoomId: classRoom,
    date,
    user: req.user
  });
  res.json(sheet);
});

exports.saveRegister = asyncHandler(async (req, res) => {
  const { academicYear, classRoom, date, records } = req.body;
  if (!academicYear || !classRoom || !date || !Array.isArray(records)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'academicYear, classRoom, date, and records are required' });
  }

  const result = await saveRegisterDraft({
    academicYearId: academicYear,
    classRoomId: classRoom,
    date,
    records,
    user: req.user
  });

  logAttendanceActivity({
    action: 'attendance_entry',
    description: `Attendance draft saved for class ${classRoom} on ${date}`,
    user: req.user,
    entityId: result.register._id,
    entityLabel: `${classRoom}-${date}`,
    meta: { saved: result.saved }
  });

  res.status(HTTP_STATUS.CREATED).json(result);
});

exports.submitRegister = asyncHandler(async (req, res) => {
  const { academicYear, classRoom, date } = req.body;
  const register = await submitRegister({ academicYearId: academicYear, classRoomId: classRoom, date, user: req.user });

  logAttendanceActivity({
    action: 'attendance_submit',
    description: `Attendance submitted for class ${classRoom} on ${date}`,
    user: req.user,
    entityId: register._id,
    entityLabel: `${classRoom}-${date}`
  });

  res.json(register);
});

exports.lockRegister = asyncHandler(async (req, res) => {
  const { academicYear, classRoom, date } = req.body;
  const register = await lockRegister({ academicYearId: academicYear, classRoomId: classRoom, date, user: req.user });

  logAttendanceActivity({
    action: 'attendance_lock',
    description: `Attendance locked for class ${classRoom} on ${date}`,
    user: req.user,
    entityId: register._id,
    entityLabel: `${classRoom}-${date}`
  });

  res.json(register);
});

exports.unlockRegister = asyncHandler(async (req, res) => {
  const { academicYear, classRoom, date } = req.body;
  const register = await unlockRegister({ academicYearId: academicYear, classRoomId: classRoom, date, user: req.user });

  logAttendanceActivity({
    action: 'attendance_unlock',
    description: `Attendance unlocked for class ${classRoom} on ${date}`,
    user: req.user,
    entityId: register._id,
    entityLabel: `${classRoom}-${date}`
  });

  res.json(register);
});

exports.summary = asyncHandler(async (req, res) => {
  const studentId = req.params.studentId;
  const summary = await studentAttendanceSummary(studentId, req.query.academicYear);
  res.json(summary);
});

exports.getReport = asyncHandler(async (req, res) => {
  const rows = await buildReport(req.params.type, {
    academicYear: req.query.academicYear,
    classRoom: req.query.classRoom,
    student: req.query.student,
    date: req.query.date,
    month: req.query.month,
    year: req.query.year
  });
  res.json({ type: req.params.type, rows, total: rows.length });
});

exports.downloadReportPdf = asyncHandler(async (req, res) => {
  const rows = await buildReport(req.params.type, {
    academicYear: req.query.academicYear,
    classRoom: req.query.classRoom,
    student: req.query.student,
    date: req.query.date,
    month: req.query.month,
    year: req.query.year
  });
  attendanceReportPdf(res, req.params.type, rows);
});

exports.mark = asyncHandler(async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Attendance records are required' });
  }

  const first = records[0];
  const result = await saveRegisterDraft({
    academicYearId: first.academicYear,
    classRoomId: first.classRoom,
    date: first.date,
    records,
    user: req.user
  });

  logAttendanceActivity({
    action: 'attendance_entry',
    description: `Attendance saved (${records.length} records)`,
    user: req.user,
    entityId: result.register._id,
    entityLabel: `${first.classRoom}-${first.date}`
  });

  res.status(HTTP_STATUS.CREATED).json({ saved: result.saved, register: result.register });
});

exports.studentOptions = asyncHandler(async (req, res) => {
  const filter = { status: 'active' };
  if (req.query.academicYear && req.query.classRoom) {
    filter.enrollments = {
      $elemMatch: {
        academicYear: req.query.academicYear,
        classRoom: req.query.classRoom,
        status: 'studying'
      }
    };
  }
  const students = await Student.find(filter).select('admissionNumber firstName lastName enrollments');
  res.json(students);
});

exports.selfMark = asyncHandler(async (req, res) => {
  const { status = 'present', remarks = '' } = req.body;
  const today = startOfDay(new Date());

  if (isFutureDate(today)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Attendance cannot be entered for future dates' });
  }

  const blocked = await isBlockedDate(today, { status });
  if (blocked) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: blocked });

  if (req.user.role === ROLES.STUDENT) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Students cannot submit attendance. Contact your class teacher.' });
  }

  if (req.user.role === ROLES.TEACHER) {
    const teacherId = req.user.teacher;
    if (!teacherId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'No teacher linked to this account' });

    const record = await TeacherAttendance.findOneAndUpdate(
      { teacher: teacherId, date: today },
      {
        $setOnInsert: {
          teacher: teacherId,
          date: today,
          status,
          remarks
        }
      },
      { upsert: true, new: true }
    );

    return res.status(HTTP_STATUS.CREATED).json({ type: 'teacher', record });
  }

  return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Self-attendance is only available for teachers' });
});

exports.selfStatus = asyncHandler(async (req, res) => {
  const today = startOfDay(new Date());

  if (req.user.role === ROLES.TEACHER && req.user.teacher) {
    const record = await TeacherAttendance.findOne({ teacher: req.user.teacher, date: today });
    return res.json({ marked: !!record, status: record?.status || null });
  }

  return res.json({ marked: false, status: null });
});
