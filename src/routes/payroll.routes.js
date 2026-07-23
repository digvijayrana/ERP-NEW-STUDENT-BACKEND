const router = require('express').Router();
const controller = require('../controllers/payroll.controller');
const { payroll } = require('../middleware');

router.post('/', payroll.create, controller.create);
router.get('/preview', payroll.view, controller.preview);
router.get('/', payroll.view, controller.list);
router.patch('/:id', payroll.edit, controller.update);
router.delete('/:id', payroll.delete, controller.remove);
router.post('/:id/mark-paid', payroll.approve, controller.markPaid);
router.post('/:id/unlock', payroll.unlock, controller.unlock);
router.get('/:id/pdf', payroll.view, controller.download);

module.exports = router;
