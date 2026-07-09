const router = require('express').Router();
const controller = require('../controllers/performance.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/jobs', requirePermission('dashboard', 'view'), controller.listJobs);
router.get('/jobs/:id', requirePermission('dashboard', 'view'), controller.getJob);
router.post('/jobs', requirePermission('dashboard', 'edit'), controller.enqueue);
router.post('/audit/archive', requirePermission('governance', 'edit'), controller.archiveAuditLogs);
router.get('/audit/archive', requirePermission('governance', 'view'), controller.searchArchivedAudit);
router.post('/cache/invalidate', requirePermission('governance', 'edit'), controller.invalidateCache);

module.exports = router;
