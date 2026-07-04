const Attendance = require('../models/Attendance');
const TeacherAttendance = require('../models/TeacherAttendance');
const Holiday = require('../models/Holiday');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS, ROLES } = require('../constants');

async function isBlockedDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (d.getDay() === 0) return 'Cannot mark attendance on Sunday';
  const holiday = await Holiday.findOne({ date: d });
  if (holiday) return `Cannot mark attendance on holiday: ${holiday.name}`;
  return null;
}

async function teacherClassIds(req) {
  if (req.user.role !== ROLES.TEACHER) return null;
  return ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
}

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.student) filter.student = req.query.student;
  if (req.query.classRoom) filter.classRoom = req.query.classRoom;
  if (req.query.academicYear) filter.academicYear = req.query.academicYear;
  if (req.user.role === ROLES.STUDENT) filter.student = req.user.student;
  if (req.user.role === ROLES.PARENT) {
    const childIds = req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : []);
    const selectedChild = req.query.student && childIds.map(String).includes(String(req.query.student)) ? req.query.student : null;
    filter.student = selectedChild || { $in: childIds };
  }

  const records = await Attendance.find(filter)
    .populate('student', 'firstName lastName admissionNumber')
    .populate('classRoom', 'name section')
    .populate('markedBy', 'firstName lastName')
    .sort({ date: -1 });
  res.json(records);
});

exports.mark = asyncHandler(async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records) || records.length === 0) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Attendance records are required' });

  for (const record of records) {
    const blocked = await isBlockedDate(record.date);
    if (blocked) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: blocked });
  }

  const allowedClassIds = await teacherClassIds(req);
  if (allowedClassIds) {
    const allowed = new Set(allowedClassIds.map((id) => id.toString()));
    if (records.some((record) => !allowed.has(record.classRoom))) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Teacher can mark attendance only for assigned classes' });
    }
  }

  const writes = records.map((record) => ({
    updateOne: {
      filter: { student: record.student, date: new Date(record.date) },
      update: {
        $set: {
          ...record,
          markedBy: req.user.role === ROLES.TEACHER ? req.user.teacher : record.markedBy
        }
      },
      upsert: true
    }
  }));
  await Attendance.bulkWrite(writes);
  res.status(HTTP_STATUS.CREATED).json({ saved: records.length });
});

exports.studentOptions = asyncHandler(async (req, res) => {
  const students = await Student.find().select('admissionNumber firstName lastName enrollments');
  res.json(students);
});

exports.selfMark = asyncHandler(async (req, res) => {
  const { status = 'present', remarks = '' } = req.body;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const blocked = await isBlockedDate(today);
  if (blocked) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: blocked });

  if (req.user.role === ROLES.STUDENT) {
    const studentId = req.user.student;
    if (!studentId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'No student linked to this account' });

    const student = await Student.findById(studentId);
    if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student record not found' });

    const latestEnrollment = student.enrollments?.[student.enrollments.length - 1];
    if (!latestEnrollment) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'No active enrollment found' });

    const record = await Attendance.findOneAndUpdate(
      { student: studentId, date: today },
      {
        $setOnInsert: {
          student: studentId,
          classRoom: latestEnrollment.classRoom,
          academicYear: latestEnrollment.academicYear,
          date: today,
          status,
          remarks
        }
      },
      { upsert: true, new: true }
    ).populate('classRoom', 'name section');

    return res.status(HTTP_STATUS.CREATED).json({ type: 'student', record });
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

  return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Self-attendance is only available for students and teachers' });
});

exports.selfStatus = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (req.user.role === ROLES.STUDENT && req.user.student) {
    const record = await Attendance.findOne({ student: req.user.student, date: today });
    return res.json({ marked: !!record, status: record?.status || null });
  }

  if (req.user.role === ROLES.TEACHER && req.user.teacher) {
    const record = await TeacherAttendance.findOne({ teacher: req.user.teacher, date: today });
    return res.json({ marked: !!record, status: record?.status || null });
  }

  return res.json({ marked: false, status: null });
});
