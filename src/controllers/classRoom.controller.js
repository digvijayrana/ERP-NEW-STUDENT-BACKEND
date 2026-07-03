const ClassRoom = require('../models/ClassRoom');
const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS, ROLES } = require('../constants');

function normalizeClassPayload(payload) {
  const next = { ...payload };
  if (next.classTeacher === '') delete next.classTeacher;
  if (Array.isArray(next.subjects)) {
    next.subjects = next.subjects.map((subject) => {
      const normalized = { ...subject };
      if (normalized.teacher === '') delete normalized.teacher;
      return normalized;
    });
  }
  return next;
}

async function ensureClassTeacherIsAvailable(classTeacher, classId) {
  if (!classTeacher) return;

  const existing = await ClassRoom.findOne({
    classTeacher,
    ...(classId ? { _id: { $ne: classId } } : {})
  }).select('name section');

  if (existing) {
    const error = new Error(`This teacher is already class teacher for ${existing.name}-${existing.section}`);
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
}

exports.create = asyncHandler(async (req, res) => {
  const payload = normalizeClassPayload(req.body);
  await ensureClassTeacherIsAvailable(payload.classTeacher);
  res.status(HTTP_STATUS.CREATED).json(await ClassRoom.create(payload));
});

exports.list = asyncHandler(async (req, res) => {
  const filter = req.user.role === ROLES.TEACHER ? { classTeacher: req.user.teacher } : {};
  const classes = await ClassRoom.find(filter)
    .populate('academicYear', 'name isActive')
    .populate('classTeacher', 'firstName lastName employeeCode')
    .populate('subjects.teacher', 'firstName lastName employeeCode')
    .sort({ name: 1, section: 1 });
  res.json(classes);
});

exports.update = asyncHandler(async (req, res) => {
  const payload = normalizeClassPayload(req.body);
  await ensureClassTeacherIsAvailable(payload.classTeacher, req.params.id);
  const classRoom = await ClassRoom.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
  if (!classRoom) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Class not found' });
  res.json(classRoom);
});

exports.remove = asyncHandler(async (req, res) => {
  const classRoom = await ClassRoom.findByIdAndDelete(req.params.id);
  if (!classRoom) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Class not found' });
  res.json({ deleted: true });
});
