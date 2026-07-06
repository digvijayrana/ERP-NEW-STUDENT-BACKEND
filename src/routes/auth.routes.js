const router = require('express').Router();
const controller = require('../controllers/auth.controller');
const { authenticate, authorize, requirePermission, requireSuperAdmin } = require('../middleware/auth');

router.post('/login', controller.login);
router.get('/me', authenticate, controller.me);
router.post('/users', authenticate, requirePermission('users', 'create'), controller.createUser);
router.get('/users', authenticate, requirePermission('users', 'view'), controller.listUsers);
router.patch('/users/:id', authenticate, requirePermission('users', 'edit'), controller.updateUser);
router.post('/users/:id/deactivate', authenticate, requirePermission('users', 'deactivate'), controller.deactivateUser);
router.delete('/users/:id', authenticate, requireSuperAdmin, controller.removeUser);

module.exports = router;
