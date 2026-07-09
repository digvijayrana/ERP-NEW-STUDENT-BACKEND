const { CACHE_TTL_MS } = require('../config/performance.config');

const store = new Map();

function cacheKey(namespace, key) {
  return `${namespace}:${key}`;
}

function get(namespace, key) {
  const entry = store.get(cacheKey(namespace, key));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(cacheKey(namespace, key));
    return null;
  }
  return entry.value;
}

function set(namespace, key, value, ttlMs = CACHE_TTL_MS.masterData) {
  store.set(cacheKey(namespace, key), {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function del(namespace, key) {
  store.delete(cacheKey(namespace, key));
}

function invalidateNamespace(namespace) {
  const prefix = `${namespace}:`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

async function getOrSet(namespace, key, ttlMs, loader) {
  const cached = get(namespace, key);
  if (cached !== null) return cached;
  const value = await loader();
  set(namespace, key, value, ttlMs);
  return value;
}

module.exports = {
  get,
  set,
  del,
  invalidateNamespace,
  getOrSet
};
