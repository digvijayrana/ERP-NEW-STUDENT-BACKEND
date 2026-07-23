const router = require('express').Router();
const controller = require('../controllers/compliance.controller');
const { governance } = require('../middleware');

router.get('/status', governance.view, controller.status);
router.get('/backups', governance.view, controller.listBackups);
router.post('/backups', governance.edit, controller.runBackup);
router.post('/backups/run-now', governance.edit, controller.runBackupNow);
router.get('/exceptions', governance.view, controller.listExceptions);

module.exports = router;
