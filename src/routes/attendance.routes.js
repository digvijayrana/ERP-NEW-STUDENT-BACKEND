const router = require('express').Router();
const controller = require('../controllers/attendance.controller');
const { authorize } = require('../middleware/auth');

router.get('/', authorize('admin', 'teacher', 'student', 'parent'), controller.list);
router.get('/students', authorize('admin', 'teacher'), controller.studentOptions);
router.get('/self-status', authorize('student', 'teacher'), controller.selfStatus);
router.post('/mark', authorize('admin', 'teacher'), controller.mark);
router.post('/self-mark', authorize('student', 'teacher'), controller.selfMark);

module.exports = router;
