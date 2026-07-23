const router = require('express').Router();
const controller = require('../controllers/performance.controller');
const { dashboard, governance } = require('../middleware');

router.get('/jobs', dashboard.view, controller.listJobs);
router.get('/jobs/:id', dashboard.view, controller.getJob);
router.post('/jobs', dashboard.edit, controller.enqueue);
router.post('/audit/archive', governance.edit, controller.archiveAuditLogs);
router.get('/audit/archive', governance.view, controller.searchArchivedAudit);
router.post('/cache/invalidate', governance.edit, controller.invalidateCache);

module.exports = router;
