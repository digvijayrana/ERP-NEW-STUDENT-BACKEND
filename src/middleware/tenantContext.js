/**
 * Host-header tenant resolver (no ?tenant= / no client-sent tenant id).
 *
 * abc.schoolerp.local → abc → SchoolTenant registry → school_abc_db
 * admin.schoolerp.local → control plane (super_admin_db)
 * Suspended school → HTTP 403
 */
const {
  normalizeSlug,
  isMultiTenant,
  findTenantBySlug,
  getTenantConnection,
  getControlPlaneConnection,
  connectControlPlane
} = require('../services/tenantConnection.manager');
const { runWithTenant } = require('../services/tenantContext.als');
const { createLogger } = require('../utils/logger');

const log = createLogger('tenant-resolver');

const RESERVED = new Set(['www', 'api', 'app', 'static', 'cdn', 'mail', 'status', 'localhost']);

function extractSubdomain(hostHeader = '') {
  const host = String(hostHeader).split(':')[0].toLowerCase();
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return null;
  }

  const rootDomain = (process.env.ROOT_DOMAIN || 'localhost').toLowerCase();
  if (host === rootDomain || host === `www.${rootDomain}`) {
    return null;
  }

  if (host.endsWith(`.${rootDomain}`)) {
    const sub = host.slice(0, -(rootDomain.length + 1));
    return normalizeSlug(sub.split('.')[0]);
  }

  const parts = host.split('.');
  if (parts.length >= 3) return normalizeSlug(parts[0]);
  return null;
}

function isHealthPath(urlPath = '') {
  return (
    urlPath === '/health' ||
    urlPath === '/ready' ||
    urlPath === '/metrics' ||
    urlPath === '/nginx-health' ||
    urlPath.endsWith('/health') ||
    urlPath.endsWith('/health/ready') ||
    urlPath.endsWith('/health/storage')
  );
}

async function tenantResolver(req, res, next) {
  const host = (req.get('host') || '').split(':')[0].toLowerCase();
  const fromHost = extractSubdomain(req.get('host') || '');
  const isAdminHost = fromHost === 'admin' || host.startsWith('admin.');

  req.tenantHost = host;
  req.isAdminHost = isAdminHost;

  if (!isMultiTenant()) {
    req.tenantSlug = fromHost && !RESERVED.has(fromHost) ? fromHost : normalizeSlug(process.env.TENANT_SLUG || 'default');
    return next();
  }

  if (isHealthPath(req.path)) {
    req.tenantSlug = isAdminHost ? 'admin' : fromHost || 'default';
    return next();
  }

  try {
    if (!getControlPlaneConnection()) {
      await connectControlPlane();
    }

    if (isAdminHost) {
      const connection = getControlPlaneConnection();
      req.tenantSlug = 'admin';
      req.tenant = { slug: 'admin', name: 'Platform Admin', status: 'active', dbName: connection?.name };
      return runWithTenant({ slug: 'admin', connection, tenant: req.tenant, isAdminHost: true }, () => next());
    }

    if (!fromHost || RESERVED.has(fromHost)) {
      return res.status(400).json({
        message: 'School subdomain required (e.g. abc.schoolerp.local)',
        host
      });
    }

    const tenant = await findTenantBySlug(fromHost);
    if (!tenant) {
      log.warn('Unknown school subdomain', { slug: fromHost, host });
      return res.status(404).json({
        message: `School "${fromHost}" is not registered`,
        host
      });
    }

    if (tenant.status === 'suspended') {
      return res.status(403).json({
        message: 'This school account is suspended. Contact platform support.',
        slug: tenant.slug
      });
    }

    const connection = await getTenantConnection(tenant.slug, tenant);
    req.tenantSlug = tenant.slug;
    req.tenant = tenant;

    return runWithTenant({ slug: tenant.slug, connection, tenant, isAdminHost: false }, () => next());
  } catch (error) {
    log.error('Tenant resolve failed', { error: error.message, host });
    return res.status(error.status || 503).json({
      message: error.message || 'Unable to resolve school database'
    });
  }
}

module.exports = tenantResolver;
module.exports.extractSubdomain = extractSubdomain;
module.exports.tenantContext = tenantResolver;
