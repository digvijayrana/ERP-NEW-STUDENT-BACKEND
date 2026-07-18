const { AsyncLocalStorage } = require('async_hooks');

/** Per-request tenant store: { slug, connection, tenant, isAdminHost } */
const tenantAls = new AsyncLocalStorage();

function getTenantStore() {
  return tenantAls.getStore() || null;
}

function getRequestConnection() {
  return getTenantStore()?.connection || null;
}

function runWithTenant(store, fn) {
  return tenantAls.run(store, fn);
}

module.exports = {
  tenantAls,
  getTenantStore,
  getRequestConnection,
  runWithTenant
};
