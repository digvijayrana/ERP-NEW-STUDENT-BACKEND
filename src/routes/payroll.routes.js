const router = require('express').Router();
const controller = require('../controllers/payroll.controller');
const { requirePermission } = require('../middleware/auth');

router.post('/', requirePermission('payroll', 'create'), controller.create);
router.get('/', requirePermission('payroll', 'view'), controller.list);
router.patch('/:id', requirePermission('payroll', 'edit'), controller.update);
router.delete('/:id', requirePermission('payroll', 'delete'), controller.remove);
router.post('/:id/mark-paid', requirePermission('payroll', 'approve'), controller.markPaid);
router.post('/:id/unlock', requirePermission('payroll', 'unlock'), controller.unlock);
router.get('/:id/pdf', requirePermission('payroll', 'view'), controller.download);

module.exports = router;
