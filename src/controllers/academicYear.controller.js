const AcademicYear = require('../models/AcademicYear');
const asyncHandler = require('../middleware/asyncHandler');

exports.create = asyncHandler(async (req, res) => {
  if (req.body.isActive) {
    await AcademicYear.updateMany({}, { isActive: false });
  }
  const year = await AcademicYear.create(req.body);
  res.status(201).json(year);
});

exports.list = asyncHandler(async (_req, res) => {
  res.json(await AcademicYear.find().sort({ startDate: -1 }));
});

exports.update = asyncHandler(async (req, res) => {
  if (req.body.isActive) {
    await AcademicYear.updateMany({ _id: { $ne: req.params.id } }, { isActive: false });
  }
  const year = await AcademicYear.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!year) return res.status(404).json({ message: 'Academic year not found' });
  res.json(year);
});
