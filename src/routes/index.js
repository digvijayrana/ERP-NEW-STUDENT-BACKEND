const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');

router.use('/auth', require('./auth.routes'));
router.use(authenticate);
router.use('/dashboard', require('./dashboard.routes'));
router.use('/academic-years', require('./academicYear.routes'));
router.use('/classes', require('./classRoom.routes'));
router.use('/teachers', authorize('admin', 'teacher'), require('./teacher.routes'));
router.use('/students', require('./student.routes'));
router.use('/fees', require('./fee.routes'));
router.use('/payroll', authorize('admin'), require('./payroll.routes'));
router.use('/attendance', require('./attendance.routes'));
router.use('/holidays', require('./holiday.routes'));
router.use('/timetable', require('./timetable.routes'));
router.use('/exams', require('./exam.routes'));

module.exports = router;
