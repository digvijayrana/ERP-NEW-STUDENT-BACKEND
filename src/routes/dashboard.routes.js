const router = require('express').Router();
const controller = require('../controllers/dashboard.controller');
const { dashboard } = require('../middleware');

router.get('/', dashboard.view, controller.getDashboard);

module.exports = router;
