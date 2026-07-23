const router = require('express').Router();
const controller = require('../controllers/aiInsights.controller');
const { dashboard, students } = require('../middleware');

router.get('/management', dashboard.view, controller.management);
router.get('/trends', dashboard.view, controller.trends);
router.get('/config', dashboard.view, controller.config);
router.get('/students/:studentId', students.view, controller.student);

module.exports = router;
