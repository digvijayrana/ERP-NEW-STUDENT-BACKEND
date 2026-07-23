const router = require('express').Router();
const controller = require('../controllers/governance.controller');
const { governance } = require('../middleware');

router.get('/configuration', governance.view, controller.getConfiguration);
router.put('/configuration', governance.edit, controller.updateConfiguration);
router.get('/configuration/versions', governance.view, controller.listVersions);
router.get('/configuration/sections', governance.view, controller.sections);
router.get('/data-quality', governance.view, controller.dataQualityReport);
router.get('/health', governance.view, controller.systemHealth);

module.exports = router;
