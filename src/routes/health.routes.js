const router = require('express').Router();
const { checkStorageHealth, getStorageInfo } = require('../services/documentStorage.service');

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'student-erp-api' });
});

router.get('/health/storage', async (_req, res) => {
  const info = getStorageInfo();
  const health = await checkStorageHealth();
  res.status(health.ok ? 200 : 503).json({ ...info, ...health });
});

module.exports = router;
