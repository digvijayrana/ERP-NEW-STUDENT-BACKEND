const router = require('express').Router();
const controller = require('../controllers/aiInsights.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/management', requirePermission('dashboard', 'view'), controller.management);
router.get('/trends', requirePermission('dashboard', 'view'), controller.trends);
router.get('/config', requirePermission('dashboard', 'view'), controller.config);
router.get('/students/:studentId', requirePermission('students', 'view'), controller.student);

module.exports = router;
