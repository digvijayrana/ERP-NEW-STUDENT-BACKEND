/**
 * Optional Redis-backed store for express-rate-limit.
 * Falls back to default memory store when REDIS_URL is unset (dev / single instance).
 *
 * Production (multiple API replicas): set REDIS_URL so limits are shared across instances.
 */
const { createLogger } = require('../utils/logger');

const log = createLogger('rate-limit-store');

function createRedisStore(windowMs) {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;

  let Redis;
  try {
    // Optional dependency — install ioredis for multi-instance rate limiting
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    Redis = require('ioredis');
  } catch {
    log.warn('REDIS_URL set but ioredis is not installed; using in-memory rate limit store');
    return undefined;
  }

  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false
  });

  client.on('error', (error) => {
    log.error('Redis rate-limit error', { error: error.message });
  });

  const prefix = process.env.REDIS_RATE_LIMIT_PREFIX || 'rl:erp:';

  return {
    async increment(key) {
      const redisKey = prefix + key;
      const totalHits = await client.incr(redisKey);
      if (totalHits === 1) {
        await client.pexpire(redisKey, windowMs);
      }
      const ttl = await client.pttl(redisKey);
      const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : windowMs));
      return { totalHits, resetTime };
    },
    async decrement(key) {
      await client.decr(prefix + key);
    },
    async resetKey(key) {
      await client.del(prefix + key);
    },
    shutdown() {
      return client.quit().catch(() => {});
    }
  };
}

module.exports = { createRedisStore };
