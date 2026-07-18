/**
 * Tenant Connection Manager
 *
 * Flow (MULTI_TENANT=true):
 *   Host: abc.schoolerp.local → slug "abc"
 *   → Query super_admin_db.SchoolTenant
 *   → Connect / reuse school_abc_db
 *   → AsyncLocalStorage binds request to that connection
 *   → Model proxies route queries without changing controllers
 *
 * Admin host (admin.schoolerp.local) uses the control-plane DB.
 * Auth remains JWT + Mongo sessions (stateless at the app tier).
 */
const path = require('path');
const mongoose = require('mongoose');
const { createLogger } = require('../utils/logger');
const { DEFAULTS, DB } = require('../constants');
const { getRequestConnection } = require('./tenantContext.als');
const schoolTenantDef = require('../models/SchoolTenant');
const schoolTenantSchema = schoolTenantDef.schema;

const log = createLogger('tenant-connection');

/** @type {Map<string, import('mongoose').Connection>} */
const pool = new Map();
/** @type {import('mongoose').Connection | null} */
let controlPlane = null;
/** @type {import('mongoose').Model | null} */
let SchoolTenantModel = null;

const MAX_POOL = Number(process.env.TENANT_CONNECTION_POOL_MAX || 100);
const CONTROL_PLANE_URI =
  process.env.CONTROL_PLANE_MONGODB_URI ||
  process.env.SUPER_ADMIN_MONGODB_URI ||
  'mongodb://127.0.0.1:27017/super_admin_db';

function normalizeSlug(slug = '') {
  return String(slug)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 63);
}

function isMultiTenant() {
  return String(process.env.MULTI_TENANT || '').toLowerCase() === 'true';
}

function getDefaultUri() {
  return process.env.MONGODB_URI || DEFAULTS.MONGODB_URI;
}

function buildUriForDbName(dbName) {
  const template = process.env.TENANT_MONGO_URI_TEMPLATE;
  if (template && template.includes('{{tenant}}')) {
    // Prefer dbName when template uses {{dbName}}
  }
  if (process.env.TENANT_MONGO_URI_TEMPLATE) {
    return process.env.TENANT_MONGO_URI_TEMPLATE
      .replace(/\{\{\s*tenant\s*\}\}/gi, dbName.replace(/^school_/, '').replace(/_db$/, ''))
      .replace(/\{\{\s*dbName\s*\}\}/gi, dbName);
  }
  try {
    const base = new URL(CONTROL_PLANE_URI);
    base.pathname = `/${dbName}`;
    return base.toString();
  } catch {
    return `mongodb://127.0.0.1:27017/${dbName}`;
  }
}

async function connectControlPlane() {
  if (controlPlane?.readyState === 1) return controlPlane;

  controlPlane = await mongoose.createConnection(CONTROL_PLANE_URI, {
    serverSelectionTimeoutMS: DB.SERVER_SELECTION_TIMEOUT_MS || 10000,
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
    minPoolSize: 1
  }).asPromise();

  SchoolTenantModel = controlPlane.model(
    schoolTenantDef.MODEL_NAME,
    schoolTenantSchema
  );

  log.info('Control plane MongoDB connected', { database: controlPlane.name });
  return controlPlane;
}

/** Register app schemas onto a connection (control plane or school). */
function bindModelsToConnection(conn) {
  if (!conn) return;
  for (const name of mongoose.modelNames()) {
    if (!conn.models[name]) {
      try {
        conn.model(name, mongoose.model(name).schema);
      } catch {
        /* already registered */
      }
    }
  }
}

function getControlPlaneConnection() {
  return controlPlane;
}

function getSchoolTenantModel() {
  return SchoolTenantModel;
}

async function findTenantBySlug(slug) {
  const normalized = normalizeSlug(slug);
  if (!normalized || !SchoolTenantModel) return null;
  return SchoolTenantModel.findOne({ slug: normalized }).lean();
}

function resolveUriForTenantRecord(tenant) {
  if (tenant.mongoUri) return tenant.mongoUri;
  if (process.env.TENANT_REGISTRY_JSON) {
    try {
      const registry = JSON.parse(process.env.TENANT_REGISTRY_JSON);
      if (registry[tenant.slug]) return registry[tenant.slug];
    } catch {
      /* ignore */
    }
  }
  return buildUriForDbName(tenant.dbName || `school_${tenant.slug}_db`);
}

function resolveUriForTenant(slug) {
  const normalized = normalizeSlug(slug);
  if (process.env.TENANT_REGISTRY_JSON) {
    try {
      const registry = JSON.parse(process.env.TENANT_REGISTRY_JSON);
      if (registry[normalized]) return registry[normalized];
    } catch (error) {
      log.error('Invalid TENANT_REGISTRY_JSON', { error: error.message });
    }
  }
  const template = process.env.TENANT_MONGO_URI_TEMPLATE;
  if (template) {
    return template
      .replace(/\{\{\s*tenant\s*\}\}/gi, normalized)
      .replace(/\{\{\s*dbName\s*\}\}/gi, `school_${normalized}_db`);
  }
  return buildUriForDbName(`school_${normalized}_db`);
}

async function getTenantConnection(slug, tenantRecord = null) {
  const normalized = normalizeSlug(slug);
  if (!normalized) {
    throw Object.assign(new Error('Tenant slug required'), { status: 400 });
  }

  if (pool.has(normalized)) {
    const existing = pool.get(normalized);
    if (existing.readyState === 1) return existing;
    pool.delete(normalized);
  }

  if (pool.size >= MAX_POOL) {
    const oldest = pool.keys().next().value;
    const old = pool.get(oldest);
    pool.delete(oldest);
    if (old) await old.close().catch(() => {});
    log.warn('Tenant connection pool evicted oldest', { evicted: oldest });
  }

  let uri;
  if (tenantRecord) {
    uri = resolveUriForTenantRecord(tenantRecord);
  } else {
    const fromDb = await findTenantBySlug(normalized);
    if (fromDb) uri = resolveUriForTenantRecord(fromDb);
    else uri = resolveUriForTenant(normalized);
  }

  if (!uri) {
    throw Object.assign(new Error(`No MongoDB URI for tenant "${normalized}"`), { status: 503 });
  }

  const conn = await mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: DB.SERVER_SELECTION_TIMEOUT_MS || 10000,
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2)
  }).asPromise();

  // Register same schemas on tenant connection for proxied models
  bindModelsToConnection(conn);

  try {
    const { ensureDefaultRoles } = require('./permission.service');
    // ensureDefaultRoles uses Role on default connection — seed roles on tenant via Role model on conn
    const Role = conn.models.Role || conn.model('Role', mongoose.model('Role').schema);
    const { DEFAULT_ROLE_PERMISSIONS } = require('../constants/permissions');
    for (const [slugKey, config] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      await Role.findOneAndUpdate(
        { slug: slugKey },
        {
          slug: slugKey,
          name: config.name,
          description: config.description,
          isSystem: true,
          permissions: config.permissions
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  } catch (error) {
    log.warn('Tenant role seed skipped', { tenant: normalized, error: error.message });
  }

  pool.set(normalized, conn);
  log.info('Tenant MongoDB connected', { tenant: normalized, database: conn.name });
  return conn;
}

async function connectPrimary() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const uri = isMultiTenant()
    ? CONTROL_PLANE_URI
    : getDefaultUri();

  mongoose.set('strictQuery', true);
  mongoose.connection.on('error', (error) => {
    log.error('MongoDB connection error', { error: error.message });
  });
  mongoose.connection.on('disconnected', () => {
    log.warn('MongoDB disconnected');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: DB.SERVER_SELECTION_TIMEOUT_MS,
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 50),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 5),
    autoIndex: process.env.NODE_ENV !== 'production'
  });

  if (!isMultiTenant()) {
    const { ensureDefaultRoles } = require('./permission.service');
    await ensureDefaultRoles();
  }

  log.info('Primary MongoDB connected', {
    database: mongoose.connection.name,
    multiTenant: isMultiTenant()
  });
  return mongoose.connection;
}

/**
 * Wrap global mongoose models so find/save use the ALS tenant connection.
 * Patches require.cache so controllers that require('../models/X') get the proxy.
 */
function installTenantModelProxies() {
  if (!isMultiTenant()) {
    log.info('Tenant model proxies skipped (MULTI_TENANT is not true)');
    return;
  }

  bindModelsToConnection(controlPlane);

  const modelsDir = path.join(__dirname, '../models');

  for (const name of mongoose.modelNames()) {
    const original = mongoose.models[name];
    if (!original || original.__tenantProxied) continue;

    const proxy = new Proxy(original, {
      get(target, prop, receiver) {
        if (prop === '__tenantProxied' || prop === 'schema' || prop === 'modelName' || prop === 'base') {
          return Reflect.get(target, prop, receiver);
        }
        const conn = getRequestConnection();
        const active = conn && conn.readyState === 1 ? conn : null;
        const Model = active
          ? active.models[name] || active.model(name, target.schema)
          : target;
        let value = Reflect.get(Model, prop, Model);
        // Statics like PIPELINE_STAGES live on the original export, not on per-tenant models
        if (value === undefined && Model !== target) {
          value = Reflect.get(target, prop, receiver);
        }
        if (typeof value === 'function') {
          return value.bind(Model !== target && !(prop in Model) ? target : Model);
        }
        return value;
      },
      apply(target, thisArg, args) {
        const conn = getRequestConnection();
        const Model = conn?.models?.[name] || (conn ? conn.model(name, target.schema) : target);
        return Reflect.apply(Model, thisArg, args);
      },
      construct(target, args) {
        const conn = getRequestConnection();
        const Model = conn?.models?.[name] || (conn ? conn.model(name, target.schema) : target);
        return Reflect.construct(Model, args);
      }
    });
    proxy.__tenantProxied = true;
    // Preserve module-level statics (PIPELINE_STAGES, DOC_CHECKLIST, etc.)
    for (const key of Object.keys(original)) {
      if (!(key in proxy) && typeof original[key] !== 'undefined') {
        try {
          proxy[key] = original[key];
        } catch {
          /* non-configurable */
        }
      }
    }
    mongoose.models[name] = proxy;
    if (mongoose.connection?.models) mongoose.connection.models[name] = proxy;
  }

  for (const key of Object.keys(require.cache)) {
    if (!key.startsWith(modelsDir) || !key.endsWith('.js')) continue;
    if (key.endsWith(`${path.sep}SchoolTenant.js`) || key.endsWith(`${path.sep}loadAll.js`)) continue;
    const exp = require.cache[key].exports;
    if (exp && exp.modelName && mongoose.models[exp.modelName]) {
      require.cache[key].exports = mongoose.models[exp.modelName];
    }
  }

  log.info('Tenant model proxies installed', { models: mongoose.modelNames().length });
}

function poolStats() {
  return {
    multiTenant: isMultiTenant(),
    controlPlane: controlPlane?.name || null,
    openConnections: pool.size,
    maxPool: MAX_POOL,
    primaryReadyState: mongoose.connection.readyState
  };
}

async function closeAll() {
  for (const [slug, conn] of pool.entries()) {
    await conn.close().catch((error) => log.warn('Tenant close failed', { slug, error: error.message }));
  }
  pool.clear();
  if (controlPlane) {
    await controlPlane.close().catch(() => {});
    controlPlane = null;
    SchoolTenantModel = null;
  }
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
}

module.exports = {
  normalizeSlug,
  isMultiTenant,
  resolveUriForTenant,
  getTenantConnection,
  connectPrimary,
  connectControlPlane,
  getControlPlaneConnection,
  getSchoolTenantModel,
  findTenantBySlug,
  getDefaultUri,
  installTenantModelProxies,
  bindModelsToConnection,
  poolStats,
  closeAll,
  CONTROL_PLANE_URI
};
