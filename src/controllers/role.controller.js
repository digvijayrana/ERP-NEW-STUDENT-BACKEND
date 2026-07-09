const Role = require('../models/Role');
const asyncHandler = require('../middleware/asyncHandler');
const { createLogger } = require('../utils/logger');
const { ACTIONS, MODULES } = require('../constants/permissions');
const { invalidateRoleCache, normalizePermissions } = require('../services/permission.service');
const { softDeleteDocument } = require('../services/softDelete.service');
const {
  ACTIONS: ACTIVITY_ACTIONS,
  auditOnCreate,
  auditOnUpdate,
  logEntityCreate,
  logEntityUpdate
} = require('../services/activityLog.service');
const { MODULES: ACTIVITY_MODULES } = require('../constants/activityActions');
const { HTTP_STATUS } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery } = require('../utils/pagination');
const { assertOptimisticVersion } = require('../utils/optimisticLock');

const log = createLogger('roles');

exports.list = asyncHandler(async (req, res) => {
  const mapRole = (role) => ({
    _id: role._id,
    slug: role.slug,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.toPermissionObject(),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt
  });

  if (!req.query.page && !req.query.pageSize) {
    const roles = await Role.find().sort({ name: 1 });
    return res.json(roles.map(mapRole));
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query);
  const filter = {};
  if (req.query.search) {
    const term = new RegExp(req.query.search.trim(), 'i');
    filter.$or = [{ name: term }, { slug: term }, { description: term }];
  }

  const [roles, totalItems] = await Promise.all([
    Role.find(filter).sort({ name: 1 }).skip(skip).limit(pageSize),
    Role.countDocuments(filter)
  ]);
  return sendPaginated(res, roles.map(mapRole), { page, pageSize, totalItems });
});

exports.get = asyncHandler(async (req, res) => {
  const role = await Role.findOne({ slug: req.params.slug });
  if (!role) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Role not found' });
  res.json({
    _id: role._id,
    slug: role.slug,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.toPermissionObject()
  });
});

exports.create = asyncHandler(async (req, res) => {
  const { slug, name, description, permissions } = req.body;
  if (!slug || !name) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'slug and name are required' });
  }

  const normalizedSlug = String(slug).trim().toLowerCase().replace(/\s+/g, '_');
  if (await Role.findOne({ slug: normalizedSlug })) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Role slug already exists' });
  }

  const role = await Role.create({
    slug: normalizedSlug,
    name,
    description,
    isSystem: false,
    permissions: normalizePermissions(permissions || {}),
    ...auditOnCreate(req.user)
  });

  invalidateRoleCache();
  log.info('Role created', { slug: role.slug, user: req.user.email });

  logEntityCreate({
    module: ACTIVITY_MODULES.ROLES,
    entityId: role._id,
    entityLabel: role.slug,
    action: ACTIVITY_ACTIONS.CREATE,
    description: `Role created: ${role.name}`,
    user: req.user
  });

  res.status(HTTP_STATUS.CREATED).json({
    _id: role._id,
    slug: role.slug,
    name: role.name,
    permissions: role.toPermissionObject()
  });
});

exports.updatePermissions = asyncHandler(async (req, res) => {
  const role = await Role.findOne({ slug: req.params.slug });
  if (!role) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Role not found' });

  const previousPermissions = role.toPermissionObject();
  const nextPermissions = normalizePermissions(req.body.permissions || {});
  role.permissions = nextPermissions;
  Object.assign(role, auditOnUpdate(req.user));
  await role.save();
  invalidateRoleCache();

  log.info('Role permissions updated', { slug: role.slug, user: req.user.email });

  logEntityUpdate({
    module: ACTIVITY_MODULES.ROLES,
    entityId: role._id,
    entityLabel: role.slug,
    action: ACTIVITY_ACTIONS.PERMISSION_CHANGE,
    description: `Permissions updated for role: ${role.name}`,
    user: req.user,
    req,
    previousValue: previousPermissions,
    updatedValue: nextPermissions
  });

  res.json({
    _id: role._id,
    slug: role.slug,
    name: role.name,
    permissions: role.toPermissionObject()
  });
});

exports.remove = asyncHandler(async (req, res) => {
  const role = await Role.findOne({ slug: req.params.slug });
  if (!role) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Role not found' });
  if (role.isSystem) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'System roles cannot be deleted' });
  }

  logEntityUpdate({
    module: ACTIVITY_MODULES.ROLES,
    entityId: role._id,
    entityLabel: role.slug,
    action: ACTIVITY_ACTIONS.DEACTIVATE,
    description: `Role deleted: ${role.name}`,
    user: req.user
  });

  await softDeleteDocument(role, req.user);
  invalidateRoleCache();
  log.info('Role soft deleted', { slug: role.slug, user: req.user.email });
  res.json({ deleted: true, softDeleted: true });
});

exports.getPermissionSchema = asyncHandler(async (_req, res) => {
  res.json({ modules: MODULES, actions: ACTIONS });
});
