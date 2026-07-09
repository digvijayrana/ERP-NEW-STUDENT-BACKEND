const router = require('express').Router();
const controller = require('../controllers/auth.controller');
const { authenticate, requirePermission, requireSuperAdmin, requireUnlock } = require('../middleware/auth');

router.get('/security-policy', controller.securityPolicy);
router.post('/login', controller.login);
router.post('/logout', authenticate, controller.logout);
router.get('/me', authenticate, controller.me);
router.post('/change-password', authenticate, controller.changePassword);
router.get('/assignable-roles', authenticate, requirePermission('users', 'view'), controller.listRoles);
router.post('/users', authenticate, requirePermission('users', 'create'), controller.createUser);
router.get('/users', authenticate, requirePermission('users', 'view'), controller.listUsers);
router.patch('/users/:id', authenticate, requirePermission('users', 'edit'), controller.updateUser);
router.post('/users/:id/deactivate', authenticate, requirePermission('users', 'deactivate'), controller.deactivateUser);
router.post('/users/:id/temporary-password', authenticate, requirePermission('users', 'edit'), controller.issueTemporaryPassword);
router.post('/users/:id/unlock', authenticate, requireUnlock('users'), controller.unlockAccount);
router.delete('/users/:id', authenticate, requireSuperAdmin, controller.removeUser);

module.exports = router;
