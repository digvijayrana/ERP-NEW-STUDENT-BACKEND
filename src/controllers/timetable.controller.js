const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const Timetable = require('../models/Timetable');
const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS, ROLES } = require('../constants');

async function readableClassFilter(req) {
  if (req.user.role === ROLES.ADMIN) return {};
  if (req.user.role === ROLES.TEACHER) {
    return { classRoom: { $in: await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id') } };
  }
  if (req.user.role === ROLES.PARENT) {
    const childIds = req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : []);
    const selectedChild = req.query.childId && childIds.map(String).includes(String(req.query.childId)) ? req.query.childId : childIds[0];
    if (!selectedChild) return { classRoom: null };
    const student = await Student.findById(selectedChild).select('enrollments');
    const current = student?.enrollments?.filter((item) => item.status === 'studying').at(-1);
    return current ? { classRoom: current.classRoom } : { classRoom: null };
  }
  const student = await Student.findById(req.user.student).select('enrollments');
  const current = student?.enrollments?.filter((item) => item.status === 'studying').at(-1);
  return current ? { classRoom: current.classRoom } : { classRoom: null };
}

exports.list = asyncHandler(async (req, res) => {
  const filter = await readableClassFilter(req);
  if (req.query.classRoom && req.user.role === ROLES.ADMIN) filter.classRoom = req.query.classRoom;
  const rows = await Timetable.find(filter)
    .populate('classRoom', 'name section')
    .populate('periods.teacher', 'firstName lastName employeeCode')
    .sort({ dayOfWeek: 1 });
  res.json(rows);
});

exports.upsert = asyncHandler(async (req, res) => {
  const { classRoom, academicYear, dayOfWeek, periods } = req.body;
  const row = await Timetable.findOneAndUpdate(
    { classRoom, academicYear, dayOfWeek },
    { classRoom, academicYear, dayOfWeek, periods },
    { new: true, upsert: true, runValidators: true }
  );
  res.status(HTTP_STATUS.CREATED).json(row);
});
