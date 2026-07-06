const mongoose = require('mongoose');
const { ACTIONS } = require('../constants/permissions');
const { auditFieldSchema } = require('../utils/auditFields');

const permissionActionsSchema = new mongoose.Schema(
  {
    view: { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    deactivate: { type: Boolean, default: false },
    export: { type: Boolean, default: false },
    approve: { type: Boolean, default: false }
  },
  { _id: false }
);

const roleSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    isSystem: { type: Boolean, default: false },
    permissions: {
      type: Map,
      of: permissionActionsSchema,
      default: {}
    },
    ...auditFieldSchema
  },
  { timestamps: true }
);

roleSchema.methods.toPermissionObject = function toPermissionObject() {
  const result = {};
  for (const [module, perms] of this.permissions.entries()) {
    result[module] = {};
    for (const action of ACTIONS) {
      result[module][action] = !!perms?.[action];
    }
  }
  return result;
};

module.exports = mongoose.model('Role', roleSchema);
