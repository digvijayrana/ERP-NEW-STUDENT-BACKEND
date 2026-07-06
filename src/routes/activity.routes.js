const router = require('express').Router();
const activityController = require('../controllers/activity.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/', requirePermission('dashboard', 'view'), activityController.list);
router.get('/:id', requirePermission('dashboard', 'view'), activityController.get);

module.exports = router;
