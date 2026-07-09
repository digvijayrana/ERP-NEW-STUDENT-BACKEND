const Activity = require('../models/Activity');
const ActivityArchive = require('../models/ActivityArchive');
const { AUDIT_RETENTION_DAYS, AUDIT_ARCHIVE_BATCH_SIZE } = require('../config/performance.config');
const { recordActivity } = require('./activityLog.service');
const { MODULES, ACTIONS } = require('../constants/activityActions');

async function archiveActivities(options = {}) {
  const retentionDays = options.retentionDays || AUDIT_RETENTION_DAYS;
  const batchSize = options.batchSize || AUDIT_ARCHIVE_BATCH_SIZE;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const activities = await Activity.find({ performedAt: { $lt: cutoff } })
    .sort({ performedAt: 1 })
    .limit(batchSize)
    .lean();

  if (!activities.length) {
    return { archived: 0, cutoff: cutoff.toISOString() };
  }

  const archiveDocs = activities.map((entry) => ({
    module: entry.module,
    entityId: entry.entityId,
    entityLabel: entry.entityLabel,
    action: entry.action,
    description: entry.description,
    performedBy: entry.performedBy,
    performedAt: entry.performedAt,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
    previousValue: entry.previousValue,
    updatedValue: entry.updatedValue,
    remarks: entry.remarks,
    meta: entry.meta,
    sourceId: entry._id,
    archivedAt: new Date()
  }));

  await ActivityArchive.insertMany(archiveDocs, { ordered: false });

  const ids = activities.map((entry) => entry._id);
  await Activity.collection.deleteMany({ _id: { $in: ids } });

  if (options.user) {
    recordActivity({
      module: MODULES.GOVERNANCE,
      entityLabel: 'audit_archive',
      action: ACTIONS.UPDATE,
      description: `Archived ${activities.length} audit log record(s) older than ${retentionDays} days`,
      user: options.user,
      meta: { archived: activities.length, cutoff: cutoff.toISOString() }
    });
  }

  return { archived: activities.length, cutoff: cutoff.toISOString(), hasMore: activities.length === batchSize };
}

async function searchArchivedActivities({ module, action, search, skip = 0, limit = 50 }) {
  const filter = {};
  if (module) filter.module = module;
  if (action) filter.action = action;
  if (search) {
    filter.$or = [
      { description: new RegExp(search.trim(), 'i') },
      { entityLabel: new RegExp(search.trim(), 'i') }
    ];
  }

  const [items, totalItems] = await Promise.all([
    ActivityArchive.find(filter).sort({ performedAt: -1 }).skip(skip).limit(limit).lean(),
    ActivityArchive.countDocuments(filter)
  ]);

  return { items, totalItems };
}

module.exports = {
  archiveActivities,
  searchArchivedActivities
};
