const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const Timetable = require('../models/Timetable');
const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS, ROLES, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery } = require('../utils/pagination');

async function readableClassFilter(req) {
  if (req.user.role === ROLES.ADMIN) return {};
  if (req.user.role === ROLES.TEACHER) {
    const classIds = await ClassRoom.find({
      $or: [{ classTeacher: req.user.teacher }, { 'subjects.teacher': req.user.teacher }]
    }).distinct('_id');
    return { classRoom: { $in: classIds } };
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

function timetableQuery(filter) {
  return Timetable.find(filter)
    .populate('classRoom', 'name section')
    .populate('periods.teacher', 'firstName lastName employeeCode')
    .sort({ dayOfWeek: 1 });
}

exports.list = asyncHandler(async (req, res) => {
  const filter = await readableClassFilter(req);
  if (req.query.classRoom && req.user.role === ROLES.ADMIN) filter.classRoom = req.query.classRoom;
  if (req.query.search) {
    const term = new RegExp(req.query.search.trim(), 'i');
    filter.$or = [{ dayOfWeek: term }];
  }

  if (!req.query.page && !req.query.pageSize) {
    const rows = await timetableQuery(filter);
    return res.json(rows);
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const [rows, totalItems] = await Promise.all([
    timetableQuery(filter).skip(skip).limit(pageSize),
    Timetable.countDocuments(filter)
  ]);
  return sendPaginated(res, rows, { page, pageSize, totalItems });
});

exports.upsert = asyncHandler(async (req, res) => {
  const { classRoom, academicYear, dayOfWeek, periods = [] } = req.body;
  const filter = { classRoom, academicYear, dayOfWeek };
  const existing = await Timetable.findOne(filter);

  let nextPeriods = periods;
  if (existing?.periods?.length && periods.length === 1) {
    nextPeriods = [...existing.periods, periods[0]].sort((left, right) =>
      String(left.startTime).localeCompare(String(right.startTime))
    );
  }

  const row = await Timetable.findOneAndUpdate(
    filter,
    { classRoom, academicYear, dayOfWeek, periods: nextPeriods },
    { new: true, upsert: true, runValidators: true }
  )
    .populate('classRoom', 'name section')
    .populate('periods.teacher', 'firstName lastName employeeCode');

  res.status(HTTP_STATUS.CREATED).json(row);
});

exports.deletePeriod = asyncHandler(async (req, res) => {
  const row = await Timetable.findById(req.params.id);
  if (!row) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Timetable not found' });

  const before = row.periods.length;
  row.periods.pull({ _id: req.params.periodId });
  if (row.periods.length === before) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Period not found' });
  }

  if (!row.periods.length) {
    await row.deleteOne();
    return res.json({ _id: row._id, classRoom: row.classRoom, dayOfWeek: row.dayOfWeek, periods: [] });
  }

  await row.save();
  const populated = await Timetable.findById(row._id)
    .populate('classRoom', 'name section')
    .populate('periods.teacher', 'firstName lastName employeeCode');
  res.json(populated);
});
