const router = require('express').Router();
const controller = require('../controllers/workflow.controller');
const { dashboard } = require('../middleware');

router.get('/notifications', dashboard.view, controller.notifications);
router.post('/notifications/dismiss', dashboard.view, controller.dismissNotification);
router.post('/notifications/reset', dashboard.view, controller.resetNotifications);
router.get('/search', dashboard.view, controller.search);
router.get('/defaults', dashboard.view, controller.defaults);
router.post('/bulk', dashboard.view, controller.bulk);

module.exports = router;
