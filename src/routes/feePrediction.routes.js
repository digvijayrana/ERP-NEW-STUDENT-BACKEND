const router = require('express').Router();
const controller = require('../controllers/feePrediction.controller');
const { fee_prediction: fp } = require('../middleware');

router.get('/dashboard', fp.view, controller.dashboard);
router.get('/predictions', fp.view, controller.predictions);
router.post('/reminders/prepare', fp.create, controller.prepareReminders);
router.post('/reminders/send', fp.create, controller.sendReminders);

module.exports = router;
