const Holiday = require('../models/Holiday');
const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS, PAGINATION } = require('../constants');
const { softDeleteDocument } = require('../services/softDelete.service');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery } = require('../utils/pagination');

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.academicYear) filter.academicYear = req.query.academicYear;
  if (req.query.year) {
    const y = parseInt(req.query.year, 10);
    filter.date = { $gte: new Date(y, 0, 1), $lte: new Date(y, 11, 31) };
  }
  if (req.query.search) {
    filter.name = new RegExp(req.query.search.trim(), 'i');
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const [holidays, totalItems] = await Promise.all([
    Holiday.find(filter).sort({ date: 1 }).skip(skip).limit(pageSize),
    Holiday.countDocuments(filter)
  ]);

  if (req.query.page || req.query.pageSize) {
    return sendPaginated(res, holidays, { page, pageSize, totalItems });
  }

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
  const holiday = await Holiday.findById(req.params.id);
  if (!holiday) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Holiday not found' });
  await softDeleteDocument(holiday, req.user);
  res.json({ message: 'Holiday removed', softDeleted: true });
});
