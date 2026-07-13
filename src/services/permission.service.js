const Role = require('../models/Role');
const { DEFAULT_ROLE_PERMISSIONS, MODULES, ACTIONS } = require('../constants/permissions');
const { createLogger } = require('../utils/logger');

const log = createLogger('permissions');
const roleCache = new Map();
const CACHE_TTL_MS = 60_000;
let cacheExpiresAt = 0;

const ROLE_ALIASES = {
  reception: 'receptionist'
};

function resolveRoleSlug(roleSlug) {
  if (DEFAULT_ROLE_PERMISSIONS[roleSlug] || roleCache.has(roleSlug)) return roleSlug;
  return ROLE_ALIASES[roleSlug] || roleSlug;
}

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

function mergePermissions(base = {}, override = {}) {
  // Union of the code defaults and the stored (DB) permissions. Because built-in
  // system roles are re-seeded to their code defaults on boot / cache refresh,
  // this guarantees a newly added module is granted immediately for those roles
  // without waiting for the reseed, while still honouring any extra DB grants.
  const merged = {};
  for (const module of MODULES) {
    merged[module] = {};
    for (const action of ACTIONS) {
      merged[module][action] = !!base?.[module]?.[action] || !!override?.[module]?.[action];
    }
  }
  return merged;
}

async function getPermissionsForRole(roleSlug) {
  await loadRoleCache();
  if (roleSlug === 'super_admin') {
    return normalizePermissions(DEFAULT_ROLE_PERMISSIONS.super_admin.permissions);
  }
  const resolved = resolveRoleSlug(roleSlug);
  const stored = roleCache.get(resolved) || roleCache.get(roleSlug);
  const defaults = DEFAULT_ROLE_PERMISSIONS[resolved] || DEFAULT_ROLE_PERMISSIONS[roleSlug];
  // For built-in roles, layer stored (DB) permissions over the code defaults so a
  // freshly added module is visible even before the role document is re-seeded.
  if (defaults) return mergePermissions(defaults.permissions, stored || {});
  return stored || normalizePermissions({});
}

async function assertAssignableRole(roleSlug) {
  if (roleSlug === 'super_admin') return true;
  await loadRoleCache();
  const resolved = resolveRoleSlug(roleSlug);
  if (roleCache.has(resolved) || roleCache.has(roleSlug)) return true;
  const role = await Role.findOne({ slug: roleSlug }).lean();
  if (!role) {
    const error = new Error(`Unknown role: ${roleSlug}`);
    error.status = 400;
    throw error;
  }
  return true;
}

function hasPermission(permissions, module, action) {
  return !!permissions?.[module]?.[action];
}

exports.ensureDefaultRoles = ensureDefaultRoles;
exports.invalidateRoleCache = invalidateCache;
exports.getPermissionsForRole = getPermissionsForRole;
exports.assertAssignableRole = assertAssignableRole;
exports.hasPermission = hasPermission;
exports.normalizePermissions = normalizePermissions;
exports.MODULES = MODULES;
exports.ACTIONS = ACTIONS;
