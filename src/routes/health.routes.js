const router = require('express').Router();
const mongoose = require('mongoose');
const { checkStorageHealth, getStorageInfo } = require('../services/documentStorage.service');
const { poolStats } = require('../services/tenantConnection.manager');

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'student-erp-api',
    tenantSlug: _req.tenantSlug || null
  });
});

router.get('/health/ready', (_req, res) => {
  const dbOk = mongoose.connection.readyState === 1;
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    mongo: dbOk ? 'up' : 'down',
    tenant: poolStats()
  });
});

router.get('/health/storage', async (_req, res) => {
  const info = getStorageInfo();
  const health = await checkStorageHealth();
  res.status(health.ok ? 200 : 503).json({ ...info, ...health });
});

module.exports = router;
