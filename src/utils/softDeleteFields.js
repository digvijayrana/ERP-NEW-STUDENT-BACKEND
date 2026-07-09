const mongoose = require('mongoose');

const softDeleteFieldSchema = {
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: Date,
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
};

function applySoftDeleteMiddleware(schema) {
  const queryMethods = ['find', 'findOne', 'findOneAndUpdate', 'countDocuments', 'distinct'];
  queryMethods.forEach((method) => {
    schema.pre(method, function excludeDeletedRecords() {
      const options = this.getOptions?.() || {};
      if (options.includeDeleted) return;
      if (options.includeDeletedOnly) {
        this.where({ isDeleted: true });
        return;
      }
      this.where({ isDeleted: { $ne: true } });
    });
  });
}

module.exports = {
  softDeleteFieldSchema,
  applySoftDeleteMiddleware
};
