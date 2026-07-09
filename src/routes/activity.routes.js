const router = require('express').Router();
const activityController = require('../controllers/activity.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/', requirePermission('governance', 'view'), activityController.list);
router.get('/:id', requirePermission('governance', 'view'), activityController.get);

module.exports = router;
