const auditFieldSchema = {
  createdBy: { type: require('mongoose').Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: require('mongoose').Schema.Types.ObjectId, ref: 'User' }
};

function auditOnCreate(user) {
  if (!user?._id) return {};
  return { createdBy: user._id, updatedBy: user._id };
}

function auditOnUpdate(user) {
  if (!user?._id) return {};
  return { updatedBy: user._id };
}

module.exports = {
  auditFieldSchema,
  auditOnCreate,
  auditOnUpdate
};
