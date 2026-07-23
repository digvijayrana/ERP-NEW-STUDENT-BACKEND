const router = require('express').Router();
const controller = require('../controllers/businessRules.controller');
const { governance } = require('../middleware');

router.get('/catalog', governance.view, controller.catalog);
router.get('/policies', governance.view, controller.policies);
router.get('/policies/:section/history', governance.view, controller.policyHistory);
router.get('/policies/:section/effective', governance.view, controller.effectivePolicy);

module.exports = router;
