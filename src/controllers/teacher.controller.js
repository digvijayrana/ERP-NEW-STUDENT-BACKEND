const Teacher = require('../models/Teacher');
const asyncHandler = require('../middleware/asyncHandler');

exports.create = asyncHandler(async (req, res) => {
  res.status(201).json(await Teacher.create(req.body));
});

exports.list = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'teacher' ? { _id: req.user.teacher } : {};
  res.json(await Teacher.find(filter).sort({ firstName: 1 }));
});

exports.get = asyncHandler(async (req, res) => {
  if (req.user.role === 'teacher' && req.user.teacher?.toString() !== req.params.id) {
    return res.status(403).json({ message: 'Teachers can only access their own staff profile' });
  }
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
  res.json(teacher);
});

exports.update = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
  res.json(teacher);
});

exports.remove = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findByIdAndDelete(req.params.id);
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
  res.json({ deleted: true });
});
