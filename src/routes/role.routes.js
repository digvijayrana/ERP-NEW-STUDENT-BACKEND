const router = require('express').Router();
const controller = require('../controllers/role.controller');
const { requirePermission, requireSuperAdmin } = require('../middleware/auth');

router.get('/schema', requirePermission('roles', 'view'), controller.getPermissionSchema);
router.get('/', requirePermission('roles', 'view'), controller.list);
router.get('/:slug', requirePermission('roles', 'view'), controller.get);
router.post('/', requireSuperAdmin, controller.create);
router.patch('/:slug/permissions', requireSuperAdmin, controller.updatePermissions);
router.delete('/:slug', requireSuperAdmin, controller.remove);

module.exports = router;
