const Attendance = require('../models/Attendance');
const AttendanceRegister = require('../models/AttendanceRegister');
const Holiday = require('../models/Holiday');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const { HTTP_STATUS, ROLES } = require('../constants');
const { ensureAcademicYearEditable } = require('./integrity.service');
const { getPermissionsForRole } = require('./permission.service');
const { canUnlock } = require('./scope.service');
const { getPolicySection } = require('./governanceConfig.service');
const PRESENT_STATUSES = new Set(['present', 'late', 'half_day']);

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function calendarDateKey(date = new Date(), timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function startOfDayFromCalendarKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const result = new Date();
  result.setFullYear(year, month - 1, day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfDayInTimezone(date = new Date(), timeZone = 'Asia/Kolkata') {
  return startOfDayFromCalendarKey(calendarDateKey(date, timeZone));
}

function weekdayInTimezone(date = new Date(), timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(date);
}

function isSundayInTimezone(date = new Date(), timeZone = 'Asia/Kolkata') {
  return weekdayInTimezone(date, timeZone) === 'Sunday';
}

function isFutureDate(date) {
  const today = startOfDay(new Date());
  return startOfDay(date) > today;
}

async function findHoliday(date) {
  return Holiday.findOne({ date: startOfDay(date) });
}

async function isBlockedDate(date, { allowHolidayStatus = false, status } = {}) {
  const d = startOfDay(date);
  if (d.getDay() === 0) return 'Cannot mark attendance on Sunday';
  const holiday = await findHoliday(d);
  if (holiday && status !== 'holiday' && !allowHolidayStatus) {
    return `Cannot mark attendance on holiday: ${holiday.name}. Use Holiday status if applicable.`;
  }
  return null;
}

async function teacherClassIds(user) {
  if (user.role !== ROLES.TEACHER) return null;
  return ClassRoom.find({ classTeacher: user.teacher }).distinct('_id');
}

async function assertTeacherClassAccess(user, classRoomId) {
  const allowed = await teacherClassIds(user);
  if (!allowed) return;
  if (!allowed.map(String).includes(String(classRoomId))) {
    const error = new Error('Teacher can mark attendance only for assigned classes');
    error.status = HTTP_STATUS.FORBIDDEN;
    throw error;
  }
}

async function getActiveStudents(academicYearId, classRoomId) {
  return Student.find({
    status: 'active',
    enrollments: {
      $elemMatch: {
        academicYear: academicYearId,
        classRoom: classRoomId,
        status: 'studying'
      }
    }
  })
    .select('admissionNumber firstName lastName enrollments')
    .sort({ 'enrollments.rollNumber': 1, firstName: 1 });
}

async function getOrCreateRegister({ academicYearId, classRoomId, date, user }) {
  const day = startOfDay(date);
  let register = await AttendanceRegister.findOne({
    academicYear: academicYearId,
    classRoom: classRoomId,
    date: day
  });

  if (!register) {
    register = await AttendanceRegister.create({
      academicYear: academicYearId,
      classRoom: classRoomId,
      date: day,
      workflowStatus: 'draft',
      markedBy: user.role === ROLES.TEACHER ? user.teacher : undefined,
      createdBy: user.id,
      updatedBy: user.id
    });
  }

  return register;
}

function assertRegisterEditable(register) {
  if (register.workflowStatus === 'locked') {
    const error = new Error('Attendance register is locked and cannot be modified');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
  if (register.workflowStatus === 'submitted') {
    const error = new Error('Submitted attendance cannot be modified. An administrator must unlock it first.');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
}

function computeSummary(records) {
  const present = records.filter((r) => PRESENT_STATUSES.has(r.status)).length;
  const absent = records.filter((r) => r.status === 'absent').length;
  const leave = records.filter((r) => r.status === 'leave').length;
  const holiday = records.filter((r) => r.status === 'holiday').length;
  const countable = present + absent + leave;
  const percentage = countable ? Math.round((present / countable) * 100) : 100;

  return { present, absent, leave, holiday, total: records.length, percentage };
}

async function loadRegisterSheet({ academicYearId, classRoomId, date, user }) {
  const day = startOfDay(date);
  if (isFutureDate(day)) {
    const error = new Error('Attendance cannot be entered for future dates');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  await assertTeacherClassAccess(user, classRoomId);

  const [students, register, records, classRoom, holiday] = await Promise.all([
    getActiveStudents(academicYearId, classRoomId),
    AttendanceRegister.findOne({ academicYear: academicYearId, classRoom: classRoomId, date: day }),
    Attendance.find({ academicYear: academicYearId, classRoom: classRoomId, date: day }),
    ClassRoom.findById(classRoomId).select('name section'),
    findHoliday(day)
  ]);

  const recordMap = Object.fromEntries(records.map((r) => [r.student.toString(), r]));
  const defaultStatus = holiday ? 'holiday' : 'present';

  const rows = students.map((student) => {
    const existing = recordMap[student._id.toString()];
    return {
      student,
      status: existing?.status || defaultStatus,
      remarks: existing?.remarks || '',
      recordId: existing?._id || null
    };
  });

  return {
    register: register || {
      academicYear: academicYearId,
      classRoom: classRoomId,
      date: day,
      workflowStatus: 'draft'
    },
    classRoom,
    holiday: holiday ? { name: holiday.name, date: holiday.date } : null,
    isSunday: day.getDay() === 0,
    rows,
    summary: computeSummary(rows.map((row) => ({ status: row.status })))
  };
}

async function saveRegisterDraft({ academicYearId, classRoomId, date, records, user }) {
  const day = startOfDay(date);
  if (isFutureDate(day)) {
    const error = new Error('Attendance cannot be entered for future dates');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  await ensureAcademicYearEditable(academicYearId);
  await assertTeacherClassAccess(user, classRoomId);

  const register = await getOrCreateRegister({ academicYearId, classRoomId, date: day, user });
  assertRegisterEditable(register);

  const students = await getActiveStudents(academicYearId, classRoomId);
  const allowedStudentIds = new Set(students.map((s) => s._id.toString()));

  for (const record of records) {
    if (!allowedStudentIds.has(String(record.student))) {
      const error = new Error('Attendance can only be marked for active students in the selected class');
      error.status = HTTP_STATUS.BAD_REQUEST;
      throw error;
    }
    const blocked = await isBlockedDate(day, { status: record.status });
    if (blocked && record.status !== 'holiday') {
      const error = new Error(blocked);
      error.status = HTTP_STATUS.BAD_REQUEST;
      throw error;
    }
  }

  const writes = records.map((record) => ({
    updateOne: {
      filter: { student: record.student, date: day },
      update: {
        $set: {
          student: record.student,
          classRoom: classRoomId,
          academicYear: academicYearId,
          register: register._id,
          date: day,
          status: record.status,
          remarks: record.remarks || '',
          markedBy: user.role === ROLES.TEACHER ? user.teacher : record.markedBy
        }
      },
      upsert: true
    }
  }));

  if (writes.length) await Attendance.bulkWrite(writes);

  register.markedBy = user.role === ROLES.TEACHER ? user.teacher : register.markedBy;
  register.updatedBy = user.id;
  await register.save();

  const savedRecords = await Attendance.find({ register: register._id });
  return { register, summary: computeSummary(savedRecords), saved: records.length };
}

async function submitRegister({ academicYearId, classRoomId, date, user }) {
  const day = startOfDay(date);
  const register = await AttendanceRegister.findOne({
    academicYear: academicYearId,
    classRoom: classRoomId,
    date: day
  });
  if (!register) {
    const error = new Error('No attendance register found for this class and date');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }
  if (register.workflowStatus !== 'draft') {
    const error = new Error('Only draft attendance can be submitted');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  const count = await Attendance.countDocuments({ register: register._id });
  if (!count) {
    const error = new Error('Mark attendance for at least one student before submitting');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  register.workflowStatus = 'submitted';
  register.submittedAt = new Date();
  register.submittedBy = user.id;
  register.updatedBy = user.id;
  await register.save();
  return register;
}

async function lockRegister({ academicYearId, classRoomId, date, user }) {
  if (user.role !== ROLES.ADMIN && user.role !== ROLES.SUPER_ADMIN) {
    const error = new Error('Only administrators can lock attendance');
    error.status = HTTP_STATUS.FORBIDDEN;
    throw error;
  }
  const day = startOfDay(date);
  const register = await AttendanceRegister.findOne({
    academicYear: academicYearId,
    classRoom: classRoomId,
    date: day
  });
  if (!register) {
    const error = new Error('No attendance register found for this class and date');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }
  if (register.workflowStatus === 'locked') {
    const error = new Error('Attendance register is already locked');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
  const rules = await getPolicySection('attendanceRules');
  if (rules.requireRegisterSubmission !== false && register.workflowStatus !== 'submitted') {
    const error = new Error('Attendance must be submitted before it can be locked');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  register.workflowStatus = 'locked';
  register.lockedAt = new Date();
  register.lockedBy = user.id;
  register.updatedBy = user.id;
  await register.save();
  return register;
}

async function unlockRegister({ academicYearId, classRoomId, date, user, permissions }) {
  const effectivePermissions = permissions || await getPermissionsForRole(user.role);
  if (!canUnlock(user, effectivePermissions, 'attendance')) {
    const error = new Error('You do not have permission to unlock attendance');
    error.status = HTTP_STATUS.FORBIDDEN;
    throw error;
  }
  const day = startOfDay(date);
  const register = await AttendanceRegister.findOne({
    academicYear: academicYearId,
    classRoom: classRoomId,
    date: day
  });
  if (!register) {
    const error = new Error('No attendance register found for this class and date');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }
  if (register.workflowStatus === 'draft') {
    const error = new Error('Attendance register is already editable');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  register.workflowStatus = 'draft';
  register.unlockedAt = new Date();
  register.unlockedBy = user.id;
  register.updatedBy = user.id;
  await register.save();
  return register;
}

async function studentAttendanceSummary(studentId, academicYearId) {
  const filter = { student: studentId };
  if (academicYearId) filter.academicYear = academicYearId;
  const records = await Attendance.find(filter).sort({ date: -1 }).lean();
  return {
    ...computeSummary(records),
    recent: records.slice(0, 30).map((r) => ({ date: r.date, status: r.status }))
  };
}

async function buildReport(reportType, filters = {}) {
  const match = {};
  if (filters.academicYear) match.academicYear = filters.academicYear;
  if (filters.classRoom) match.classRoom = filters.classRoom;
  if (filters.student) match.student = filters.student;
  if (filters.date) {
    match.date = startOfDay(filters.date);
  } else if (filters.month && filters.year) {
    const month = Number(filters.month);
    const year = Number(filters.year);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    match.date = { $gte: start, $lte: end };
  } else if (filters.year && reportType === 'yearly') {
    const year = Number(filters.year);
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    match.date = { $gte: start, $lte: end };
  }

  let records = await Attendance.find(match)
    .populate('student', 'firstName lastName admissionNumber')
    .populate('classRoom', 'name section')
    .populate('academicYear', 'name')
    .sort({ date: -1 })
    .lean();

  if (filters.section) {
    records = records.filter((row) => row.classRoom?.section === filters.section);
  }

  if (reportType === 'yearly') {
    const grouped = new Map();
    for (const row of records) {
      const d = new Date(row.date);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const bucket = grouped.get(key) || {
        month: `${d.getMonth() + 1}/${d.getFullYear()}`,
        present: 0,
        absent: 0,
        leave: 0,
        total: 0
      };
      bucket.total += 1;
      if (PRESENT_STATUSES.has(row.status)) bucket.present += 1;
      else if (row.status === 'absent') bucket.absent += 1;
      else if (row.status === 'leave') bucket.leave += 1;
      grouped.set(key, bucket);
    }
    return [...grouped.values()].map((row) => ({
      ...row,
      percentage: row.present + row.absent + row.leave
        ? Math.round((row.present / (row.present + row.absent + row.leave)) * 100)
        : 100
    }));
  }

  if (reportType === 'teacher-wise') {
    const classes = await ClassRoom.find({
      ...(filters.academicYear ? { academicYear: filters.academicYear } : {}),
      ...(filters.teacher ? { classTeacher: filters.teacher } : {}),
      status: 'active'
    }).populate('classTeacher', 'firstName lastName employeeCode').lean();

    const classMap = Object.fromEntries(classes.map((room) => [String(room._id), room]));
    const grouped = new Map();
    for (const row of records) {
      const classId = String(row.classRoom?._id || row.classRoom);
      const room = classMap[classId];
      if (!room) continue;
      const teacherId = String(room.classTeacher?._id || room.classTeacher || 'unassigned');
      const bucket = grouped.get(teacherId) || {
        teacherName: room.classTeacher ? teacherLabel(room.classTeacher) : 'Unassigned',
        employeeCode: room.classTeacher?.employeeCode || '—',
        classes: new Set(),
        present: 0,
        absent: 0,
        leave: 0,
        total: 0
      };
      bucket.classes.add(classLabel(room));
      bucket.total += 1;
      if (PRESENT_STATUSES.has(row.status)) bucket.present += 1;
      else if (row.status === 'absent') bucket.absent += 1;
      else if (row.status === 'leave') bucket.leave += 1;
      grouped.set(teacherId, bucket);
    }
    return [...grouped.values()].map((row) => ({
      teacherName: row.teacherName,
      employeeCode: row.employeeCode,
      classes: [...row.classes].join(', '),
      present: row.present,
      absent: row.absent,
      leave: row.leave,
      total: row.total,
      percentage: row.present + row.absent + row.leave
        ? Math.round((row.present / (row.present + row.absent + row.leave)) * 100)
        : 100
    }));
  }

  if (reportType === 'daily') {
    return records.map((row) => ({
      date: row.date,
      studentName: studentLabel(row.student),
      admissionNumber: row.student?.admissionNumber || '',
      className: classLabel(row.classRoom),
      status: row.status,
      remarks: row.remarks || ''
    }));
  }

  if (reportType === 'monthly') {
    const grouped = new Map();
    for (const row of records) {
      const d = new Date(row.date);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${row.student?._id}`;
      const bucket = grouped.get(key) || {
        studentName: studentLabel(row.student),
        admissionNumber: row.student?.admissionNumber || '',
        className: classLabel(row.classRoom),
        month: `${d.getMonth() + 1}/${d.getFullYear()}`,
        present: 0,
        absent: 0,
        leave: 0,
        holiday: 0,
        total: 0
      };
      bucket.total += 1;
      if (PRESENT_STATUSES.has(row.status)) bucket.present += 1;
      else if (row.status === 'absent') bucket.absent += 1;
      else if (row.status === 'leave') bucket.leave += 1;
      else if (row.status === 'holiday') bucket.holiday += 1;
      grouped.set(key, bucket);
    }
    return [...grouped.values()].map((row) => ({
      ...row,
      percentage: row.present + row.absent + row.leave
        ? Math.round((row.present / (row.present + row.absent + row.leave)) * 100)
        : 100
    }));
  }

  if (reportType === 'student-summary') {
    const grouped = new Map();
    for (const row of records) {
      const key = String(row.student?._id || row.student);
      const bucket = grouped.get(key) || {
        studentName: studentLabel(row.student),
        admissionNumber: row.student?.admissionNumber || '',
        className: classLabel(row.classRoom),
        present: 0,
        absent: 0,
        leave: 0,
        holiday: 0,
        total: 0
      };
      bucket.total += 1;
      if (PRESENT_STATUSES.has(row.status)) bucket.present += 1;
      else if (row.status === 'absent') bucket.absent += 1;
      else if (row.status === 'leave') bucket.leave += 1;
      else if (row.status === 'holiday') bucket.holiday += 1;
      grouped.set(key, bucket);
    }
    return [...grouped.values()].map((row) => ({
      ...row,
      percentage: row.present + row.absent + row.leave
        ? Math.round((row.present / (row.present + row.absent + row.leave)) * 100)
        : 100
    }));
  }

  if (reportType === 'class-summary') {
    const grouped = new Map();
    for (const row of records) {
      const key = String(row.classRoom?._id || row.classRoom);
      const bucket = grouped.get(key) || {
        className: classLabel(row.classRoom),
        present: 0,
        absent: 0,
        leave: 0,
        holiday: 0,
        total: 0,
        students: new Set()
      };
      bucket.total += 1;
      bucket.students.add(String(row.student?._id || row.student));
      if (PRESENT_STATUSES.has(row.status)) bucket.present += 1;
      else if (row.status === 'absent') bucket.absent += 1;
      else if (row.status === 'leave') bucket.leave += 1;
      else if (row.status === 'holiday') bucket.holiday += 1;
      grouped.set(key, bucket);
    }
    return [...grouped.values()].map((row) => ({
      className: row.className,
      studentCount: row.students.size,
      present: row.present,
      absent: row.absent,
      leave: row.leave,
      holiday: row.holiday,
      total: row.total,
      percentage: row.present + row.absent + row.leave
        ? Math.round((row.present / (row.present + row.absent + row.leave)) * 100)
        : 100
    }));
  }

  const error = new Error('Unknown attendance report type');
  error.status = HTTP_STATUS.BAD_REQUEST;
  throw error;
}

function classLabel(classRoom) {
  if (!classRoom) return '';
  return `${classRoom.name || ''}-${classRoom.section || ''}`.replace(/^-|-$/g, '') || '—';
}

function teacherLabel(teacher) {
  if (!teacher) return '';
  return [teacher.firstName, teacher.lastName].filter(Boolean).join(' ');
}

function studentLabel(student) {
  if (!student) return '';
  return [student.firstName, student.lastName].filter(Boolean).join(' ');
}

module.exports = {
  startOfDay,
  calendarDateKey,
  startOfDayFromCalendarKey,
  startOfDayInTimezone,
  weekdayInTimezone,
  isSundayInTimezone,
  isFutureDate,
  isBlockedDate,
  teacherClassIds,
  computeSummary,
  loadRegisterSheet,
  saveRegisterDraft,
  submitRegister,
  lockRegister,
  unlockRegister,
  studentAttendanceSummary,
  buildReport,
  getActiveStudents
};
