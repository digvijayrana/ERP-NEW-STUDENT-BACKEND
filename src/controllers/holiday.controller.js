const Holiday = require('../models/Holiday');
const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS } = require('../constants');

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.academicYear) filter.academicYear = req.query.academicYear;
  if (req.query.year) {
    const y = parseInt(req.query.year, 10);
    filter.date = { $gte: new Date(y, 0, 1), $lte: new Date(y, 11, 31) };
  }
  const holidays = await Holiday.find(filter).sort({ date: 1 });
  res.json(holidays);
});

exports.create = asyncHandler(async (req, res) => {
  const { date, name, description, academicYear } = req.body;
  const holiday = await Holiday.create({
    date: new Date(date),
    name,
    description,
    academicYear: academicYear || undefined,
    createdBy: req.user._id
  });
  res.status(HTTP_STATUS.CREATED).json(holiday);
});

exports.remove = asyncHandler(async (req, res) => {
  const holiday = await Holiday.findByIdAndDelete(req.params.id);
  if (!holiday) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Holiday not found' });
  res.json({ message: 'Holiday deleted' });
});
