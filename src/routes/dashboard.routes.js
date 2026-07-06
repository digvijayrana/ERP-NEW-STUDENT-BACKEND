const router = require('express').Router();
const controller = require('../controllers/dashboard.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/', requirePermission('dashboard', 'view'), controller.getDashboard);

module.exports = router;
