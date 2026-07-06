const router = require('express').Router();
const controller = require('../controllers/academicYear.controller');
const { requirePermission } = require('../middleware/auth');

router.post('/', requirePermission('academic_year', 'create'), controller.create);
router.get('/', requirePermission('academic_year', 'view'), controller.list);
router.get('/:id', requirePermission('academic_year', 'view'), controller.get);
router.patch('/:id', requirePermission('academic_year', 'edit'), controller.update);
router.post('/:id/activate', requirePermission('academic_year', 'edit'), controller.activate);
router.post('/:id/close', requirePermission('academic_year', 'edit'), controller.close);
router.delete('/:id', requirePermission('academic_year', 'deactivate'), controller.remove);

module.exports = router;
