const router = require('express').Router();
const controller = require('../controllers/role.controller');
const { roleAdmin, requireSuperAdmin } = require('../middleware');

router.get('/schema', roleAdmin.view, controller.getPermissionSchema);
router.get('/', roleAdmin.view, controller.list);
router.get('/:slug', roleAdmin.view, controller.get);
router.post('/', requireSuperAdmin, controller.create);
router.patch('/:slug/permissions', requireSuperAdmin, controller.updatePermissions);
router.delete('/:slug', requireSuperAdmin, controller.remove);

module.exports = router;
