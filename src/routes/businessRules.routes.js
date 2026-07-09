const router = require('express').Router();
const controller = require('../controllers/businessRules.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/catalog', requirePermission('governance', 'view'), controller.catalog);
router.get('/policies', requirePermission('governance', 'view'), controller.policies);
router.get('/policies/:section/history', requirePermission('governance', 'view'), controller.policyHistory);
router.get('/policies/:section/effective', requirePermission('governance', 'view'), controller.effectivePolicy);

module.exports = router;
