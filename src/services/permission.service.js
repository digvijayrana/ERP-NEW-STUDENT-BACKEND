const Role = require('../models/Role');
const { DEFAULT_ROLE_PERMISSIONS, MODULES, ACTIONS } = require('../constants/permissions');
const { createLogger } = require('../utils/logger');

const log = createLogger('permissions');
const roleCache = new Map();
const CACHE_TTL_MS = 60_000;
let cacheExpiresAt = 0;

function normalizePermissions(raw = {}) {
  const normalized = {};
  const source = raw instanceof Map ? Object.fromEntries(raw.entries()) : raw;
  for (const module of MODULES) {
    normalized[module] = {};
    for (const action of ACTIONS) {
      normalized[module][action] = !!source?.[module]?.[action];
    }
  }
  return normalized;
}

function invalidateCache() {
  roleCache.clear();
  cacheExpiresAt = 0;
}

async function ensureDefaultRoles() {
  for (const [slug, config] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    await Role.findOneAndUpdate(
      { slug },
      {
        slug,
        name: config.name,
        description: config.description,
        isSystem: true,
        permissions: config.permissions
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  invalidateCache();
  log.info('Default roles ensured');
}

async function loadRoleCache() {
  if (Date.now() < cacheExpiresAt && roleCache.size) return;
  await ensureDefaultRoles();
  const roles = await Role.find().lean();
  roleCache.clear();
  for (const role of roles) {
    roleCache.set(role.slug, normalizePermissions(role.permissions));
  }
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
}

async function getPermissionsForRole(roleSlug) {
  await loadRoleCache();
  if (roleSlug === 'super_admin') {
    return normalizePermissions(DEFAULT_ROLE_PERMISSIONS.super_admin.permissions);
  }
  return roleCache.get(roleSlug) || normalizePermissions({});
}

function hasPermission(permissions, module, action) {
  return !!permissions?.[module]?.[action];
}

exports.ensureDefaultRoles = ensureDefaultRoles;
exports.invalidateRoleCache = invalidateCache;
exports.getPermissionsForRole = getPermissionsForRole;
exports.hasPermission = hasPermission;
exports.normalizePermissions = normalizePermissions;
exports.MODULES = MODULES;
exports.ACTIONS = ACTIONS;
