const router = require('express').Router();
const controller = require('../controllers/timetable.controller');
const { authorize } = require('../middleware/auth');

router.get('/', authorize('admin', 'teacher', 'student', 'parent'), controller.list);
router.post('/', authorize('admin'), controller.upsert);
router.delete('/:id/periods/:periodId', authorize('admin'), controller.deletePeriod);

module.exports = router;
