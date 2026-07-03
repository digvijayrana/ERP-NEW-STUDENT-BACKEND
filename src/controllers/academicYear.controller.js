const AcademicYear = require('../models/AcademicYear');
const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS } = require('../constants');

exports.create = asyncHandler(async (req, res) => {
  if (req.body.isActive) {
    await AcademicYear.updateMany({}, { isActive: false });
  }
  const year = await AcademicYear.create(req.body);
  res.status(HTTP_STATUS.CREATED).json(year);
});

exports.list = asyncHandler(async (_req, res) => {
  res.json(await AcademicYear.find().sort({ startDate: -1 }));
});

exports.update = asyncHandler(async (req, res) => {
  if (req.body.isActive) {
    await AcademicYear.updateMany({ _id: { $ne: req.params.id } }, { isActive: false });
  }
  const year = await AcademicYear.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!year) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Academic year not found' });
  res.json(year);
});
