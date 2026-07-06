const Activity = require('../models/Activity');
const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS } = require('../constants');

exports.list = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const filter = {};

  if (req.query.module) filter.module = req.query.module;
  if (req.query.action) filter.action = req.query.action;
  if (req.query.entityId) filter.entityId = req.query.entityId;

  const activities = await Activity.find(filter)
    .sort({ performedAt: -1 })
    .limit(limit)
    .lean();

  res.json(activities);
});

exports.get = asyncHandler(async (req, res) => {
  const activity = await Activity.findById(req.params.id).lean();
  if (!activity) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Activity not found' });
  res.json(activity);
});
