const Attendance = require('../models/Attendance');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS, ROLES } = require('../constants');

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
  if (req.user.role === ROLES.PARENT && req.user.linkedStudent) filter.student = req.user.linkedStudent;
  if (req.user.role === ROLES.TEACHER) filter.classRoom = { $in: await teacherClassIds(req) };

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
  const filter = {};
  if (req.user.role === ROLES.TEACHER) filter['enrollments.classRoom'] = { $in: await teacherClassIds(req) };
  const students = await Student.find(filter).select('admissionNumber firstName lastName enrollments');
  res.json(students);
});
