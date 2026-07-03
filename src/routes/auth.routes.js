const router = require('express').Router();
const controller = require('../controllers/auth.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.post('/login', controller.login);
router.get('/me', authenticate, controller.me);
router.post('/users', authenticate, authorize('admin'), controller.createUser);
router.get('/users', authenticate, authorize('admin'), controller.listUsers);

module.exports = router;
