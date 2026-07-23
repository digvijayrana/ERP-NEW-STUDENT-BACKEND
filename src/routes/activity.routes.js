const router = require('express').Router();
const activityController = require('../controllers/activity.controller');
const { governance } = require('../middleware');

router.get('/', governance.view, activityController.list);
router.get('/:id', governance.view, activityController.get);

module.exports = router;
