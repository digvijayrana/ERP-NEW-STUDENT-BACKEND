const router = require('express').Router();
const controller = require('../controllers/payroll.controller');

router.post('/', controller.create);
router.get('/', controller.list);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);
router.post('/:id/mark-paid', controller.markPaid);
router.get('/:id/pdf', controller.download);

module.exports = router;
