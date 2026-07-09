const router = require('express').Router();
const controller = require('../controllers/governance.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/configuration', requirePermission('governance', 'view'), controller.getConfiguration);
router.put('/configuration', requirePermission('governance', 'edit'), controller.updateConfiguration);
router.get('/configuration/versions', requirePermission('governance', 'view'), controller.listVersions);
router.get('/configuration/sections', requirePermission('governance', 'view'), controller.sections);
router.get('/data-quality', requirePermission('governance', 'view'), controller.dataQualityReport);
router.get('/health', requirePermission('governance', 'view'), controller.systemHealth);

module.exports = router;
