const Activity = require('../models/Activity');
const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery } = require('../utils/pagination');

exports.list = asyncHandler(async (req, res) => {
  const filter = {};

  if (req.query.module) filter.module = req.query.module;
  if (req.query.action) filter.action = req.query.action;
  if (req.query.entityId) filter.entityId = req.query.entityId;
  if (req.query.search) {
    const term = new RegExp(req.query.search.trim(), 'i');
    filter.$or = [{ description: term }, { entityLabel: term }];
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);

  const [activities, totalItems] = await Promise.all([
    Activity.find(filter).sort({ performedAt: -1 }).skip(skip).limit(pageSize).lean(),
    Activity.countDocuments(filter)
  ]);

  return sendPaginated(res, activities, { page, pageSize, totalItems });
});

exports.get = asyncHandler(async (req, res) => {
  const activity = await Activity.findById(req.params.id).lean();
  if (!activity) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Activity not found' });
  res.json(activity);
});
