const router = require('express').Router();
const controller = require('../controllers/feePrediction.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/dashboard', requirePermission('fee_prediction', 'view'), controller.dashboard);
router.get('/predictions', requirePermission('fee_prediction', 'view'), controller.predictions);
router.post('/reminders/prepare', requirePermission('fee_prediction', 'create'), controller.prepareReminders);
router.post('/reminders/send', requirePermission('fee_prediction', 'create'), controller.sendReminders);

module.exports = router;
