const router = require('express').Router();
const controller = require('../controllers/classRoom.controller');
const { authorize } = require('../middleware/auth');

router.post('/', authorize('admin'), controller.create);
router.get('/', authorize('admin', 'teacher'), controller.list);
router.patch('/:id', authorize('admin'), controller.update);
router.delete('/:id', authorize('admin'), controller.remove);

module.exports = router;
