const router = require('express').Router();
const controller = require('../controllers/holiday.controller');
const { authorize } = require('../middleware/auth');

router.get('/', authorize('admin', 'teacher', 'student', 'parent'), controller.list);
router.post('/', authorize('admin'), controller.create);
router.delete('/:id', authorize('admin'), controller.remove);

module.exports = router;
