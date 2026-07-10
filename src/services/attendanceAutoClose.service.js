const AcademicYear = require('../models/AcademicYear');
const ClassRoom = require('../models/ClassRoom');
const Teacher = require('../models/Teacher');
const TeacherAttendance = require('../models/TeacherAttendance');
const Attendance = require('../models/Attendance');
const AttendanceRegister = require('../models/AttendanceRegister');
const Holiday = require('../models/Holiday');
const { createLogger } = require('../utils/logger');
const {
  AUTO_CLOSE_HOUR,
  AUTO_CLOSE_TIMEZONE,
  AUTO_ABSENT_REMARK,
  AUTO_TEACHER_ABSENT_REMARK
} = require('../config/attendance.config');
const { startOfDay, getActiveStudents, startOfDayInTimezone, isSundayInTimezone } = require('./attendance.service');

const log = createLogger('attendanceAutoClose');
let lastRunDateKey = null;

function localDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: AUTO_CLOSE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    dateKey: `${pick('year')}-${pick('month')}-${pick('day')}`,
    hour: Number(pick('hour'))
  };
}

function shouldRunNow(date = new Date()) {
  const { hour } = localDateParts(date);
  return hour >= AUTO_CLOSE_HOUR;
}

async function autoCloseAttendanceForDate(date = new Date()) {
  const day = startOfDayInTimezone(date, AUTO_CLOSE_TIMEZONE);
  const { dateKey } = localDateParts(date);

  if (isSundayInTimezone(date, AUTO_CLOSE_TIMEZONE)) {
    return { skipped: 'sunday', dateKey };
  }

  const holiday = await Holiday.findOne({ date: day });
  if (holiday) {
    return { skipped: 'holiday', holiday: holiday.name, dateKey };
  }

  const activeYears = await AcademicYear.find({ status: 'active' }).select('_id name');
  if (!activeYears.length) {
    return { skipped: 'no_active_year', dateKey };
  }

  let studentsMarked = 0;
  let registersSubmitted = 0;
  let teachersMarked = 0;

  for (const year of activeYears) {
    const classes = await ClassRoom.find({ academicYear: year._id, status: 'active' }).select('_id name section');

    for (const classRoom of classes) {
      let register = await AttendanceRegister.findOne({
        academicYear: year._id,
        classRoom: classRoom._id,
        date: day
      });

      if (register?.autoSubmittedAt) continue;
      if (register && ['submitted', 'locked'].includes(register.workflowStatus)) continue;

      if (!register) {
        register = await AttendanceRegister.create({
          academicYear: year._id,
          classRoom: classRoom._id,
          date: day,
          workflowStatus: 'draft'
        });
      }

      const students = await getActiveStudents(year._id, classRoom._id);
      const existingRecords = await Attendance.find({
        academicYear: year._id,
        classRoom: classRoom._id,
        date: day
      }).select('student');

      const markedStudentIds = new Set(existingRecords.map((row) => String(row.student)));
      const writes = [];

      for (const student of students) {
        if (markedStudentIds.has(String(student._id))) continue;
        writes.push({
          updateOne: {
            filter: { student: student._id, date: day },
            update: {
              $set: {
                student: student._id,
                classRoom: classRoom._id,
                academicYear: year._id,
                register: register._id,
                date: day,
                status: 'absent',
                remarks: AUTO_ABSENT_REMARK
              }
            },
            upsert: true
          }
        });
        studentsMarked += 1;
      }

      if (writes.length) {
        await Attendance.bulkWrite(writes);
      }

      const recordCount = await Attendance.countDocuments({ register: register._id });
      if (register.workflowStatus === 'draft' && (recordCount > 0 || writes.length > 0)) {
        register.workflowStatus = 'submitted';
        register.submittedAt = new Date();
        register.autoSubmittedAt = new Date();
        register.autoSubmittedReason = 'Daily auto-close at 7 PM';
        await register.save();
        registersSubmitted += 1;
      }
    }
  }

  const teachers = await Teacher.find({ status: 'active' }).select('_id');
  for (const teacher of teachers) {
    const exists = await TeacherAttendance.findOne({ teacher: teacher._id, date: day }).select('_id');
    if (exists) continue;
    await TeacherAttendance.create({
      teacher: teacher._id,
      date: day,
      status: 'absent',
      remarks: AUTO_TEACHER_ABSENT_REMARK
    });
    teachersMarked += 1;
  }

  return { dateKey, studentsMarked, registersSubmitted, teachersMarked };
}

async function runAutoCloseIfDue() {
  if (!shouldRunNow()) return null;

  const { dateKey } = localDateParts();
  if (lastRunDateKey === dateKey) return null;

  const result = await autoCloseAttendanceForDate(new Date());
  if (result.skipped) {
    if (result.skipped !== 'no_active_year') {
      lastRunDateKey = dateKey;
    }
    log.info('Attendance auto-close skipped', result);
    return result;
  }
  lastRunDateKey = dateKey;
  log.info('Attendance auto-close completed', result);
  return result;
}

function startAttendanceAutoCloseScheduler() {
  setInterval(() => {
    runAutoCloseIfDue().catch((error) => {
      log.error('Attendance auto-close failed', { error: error.message });
    });
  }, require('../config/attendance.config').AUTO_CLOSE_CHECK_MS);

  runAutoCloseIfDue().catch((error) => {
    log.error('Attendance auto-close initial run failed', { error: error.message });
  });
}

module.exports = {
  shouldRunNow,
  autoCloseAttendanceForDate,
  runAutoCloseIfDue,
  startAttendanceAutoCloseScheduler
};
