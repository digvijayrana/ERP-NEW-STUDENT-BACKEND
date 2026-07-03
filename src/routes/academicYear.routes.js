const router = require('express').Router();
const controller = require('../controllers/academicYear.controller');
const { authorize } = require('../middleware/auth');

router.post('/', authorize('admin'), controller.create);
router.get('/', authorize('admin', 'teacher', 'student'), controller.list);
router.patch('/:id', authorize('admin'), controller.update);

module.exports = router;
