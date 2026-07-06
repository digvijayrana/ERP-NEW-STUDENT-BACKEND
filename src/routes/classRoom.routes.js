const router = require('express').Router();
const controller = require('../controllers/classRoom.controller');
const { requirePermission } = require('../middleware/auth');

router.post('/', requirePermission('classes', 'create'), controller.create);
router.get('/', requirePermission('classes', 'view'), controller.list);
router.patch('/:id', requirePermission('classes', 'edit'), controller.update);
router.post('/:id/toggle-status', requirePermission('classes', 'deactivate'), controller.toggleStatus);
router.delete('/:id', requirePermission('classes', 'deactivate'), controller.remove);

module.exports = router;
