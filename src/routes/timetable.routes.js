const router = require('express').Router();
const controller = require('../controllers/timetable.controller');
const { authorize } = require('../middleware/auth');

router.get('/', authorize('admin', 'teacher', 'student'), controller.list);
router.post('/', authorize('admin'), controller.upsert);

module.exports = router;
