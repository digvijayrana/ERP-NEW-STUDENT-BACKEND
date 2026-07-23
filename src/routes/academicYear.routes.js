const router = require('express').Router();
const controller = require('../controllers/academicYear.controller');
const { academic_year: academicYear } = require('../middleware');

router.post('/', academicYear.create, controller.create);
router.get('/', academicYear.view, controller.list);
router.get('/:id', academicYear.view, controller.get);
router.patch('/:id', academicYear.edit, controller.update);
router.post('/:id/activate', academicYear.edit, controller.activate);
router.post('/:id/close', academicYear.edit, controller.close);
router.delete('/:id', academicYear.deactivate, controller.remove);

module.exports = router;
