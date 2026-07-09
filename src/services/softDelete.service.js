const { getSoftDeletePolicy } = require('./governanceConfig.service');

async function softDeleteDocument(document, user, options = {}) {
  if (!document) {
    const error = new Error('Record not found');
    error.status = 404;
    throw error;
  }

  const policy = await getSoftDeletePolicy();
  if (!policy.enforceSoftDelete && !options.forceSoftDelete) {
    const error = new Error('Soft delete policy is disabled');
    error.status = 400;
    throw error;
  }

  if (document.isDeleted) {
    return { alreadyDeleted: true, id: document._id };
  }

  document.isDeleted = true;
  document.deletedAt = new Date();
  if (user?._id || user?.id) {
    document.deletedBy = user._id || user.id;
  }
  if (document.status && document.status !== 'inactive') {
    document.status = 'inactive';
  }
  if (document.isActive === true) {
    document.isActive = false;
  }
  await document.save();
  return { softDeleted: true, id: document._id, deletedAt: document.deletedAt };
}

async function restoreDocument(document, user) {
  if (!document || !document.isDeleted) {
    const error = new Error('Record is not soft deleted');
    error.status = 400;
    throw error;
  }
  document.isDeleted = false;
  document.deletedAt = undefined;
  document.deletedBy = undefined;
  if (document.schema.paths.status && document.status === 'inactive') {
    document.status = 'active';
  }
  if (document.schema.paths.isActive) {
    document.isActive = true;
  }
  if (user?._id || user?.id) {
    document.updatedBy = user._id || user.id;
  }
  await document.save();
  return { restored: true, id: document._id };
}

function notDeletedFilter(extra = {}) {
  return { ...extra, isDeleted: { $ne: true } };
}

module.exports = {
  softDeleteDocument,
  restoreDocument,
  notDeletedFilter
};
