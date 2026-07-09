const router = require('express').Router();
const controller = require('../controllers/workflow.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/notifications', requirePermission('dashboard', 'view'), controller.notifications);
router.post('/notifications/dismiss', requirePermission('dashboard', 'view'), controller.dismissNotification);
router.post('/notifications/reset', requirePermission('dashboard', 'view'), controller.resetNotifications);
router.get('/search', requirePermission('dashboard', 'view'), controller.search);
router.get('/defaults', requirePermission('dashboard', 'view'), controller.defaults);
router.post('/bulk', requirePermission('dashboard', 'view'), controller.bulk);

module.exports = router;
