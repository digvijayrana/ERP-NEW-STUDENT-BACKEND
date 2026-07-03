const router = require('express').Router();
const controller = require('../controllers/attendance.controller');
const { authorize } = require('../middleware/auth');

router.get('/', authorize('admin', 'teacher', 'student', 'parent'), controller.list);
router.get('/students', authorize('admin', 'teacher'), controller.studentOptions);
router.post('/mark', authorize('admin', 'teacher'), controller.mark);

module.exports = router;
