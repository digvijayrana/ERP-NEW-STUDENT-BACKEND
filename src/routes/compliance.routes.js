const router = require('express').Router();
const controller = require('../controllers/compliance.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/status', requirePermission('governance', 'view'), controller.status);
router.get('/backups', requirePermission('governance', 'view'), controller.listBackups);
router.post('/backups', requirePermission('governance', 'edit'), controller.runBackup);
router.post('/backups/run-now', requirePermission('governance', 'edit'), controller.runBackupNow);
router.get('/exceptions', requirePermission('governance', 'view'), controller.listExceptions);

module.exports = router;
