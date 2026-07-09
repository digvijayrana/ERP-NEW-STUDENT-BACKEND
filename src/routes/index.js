const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');

router.use(require('./health.routes'));
router.use('/auth', require('./auth.routes'));
router.use(authenticate);
router.use('/roles', require('./role.routes'));
router.use('/dashboard', require('./dashboard.routes'));
router.use('/activities', require('./activity.routes'));
router.use('/academic-years', require('./academicYear.routes'));
router.use('/classes', require('./classRoom.routes'));
router.use('/teachers', require('./teacher.routes'));
router.use('/students', require('./student.routes'));
router.use('/fees', require('./fee.routes'));
router.use('/payroll', authorize('admin'), require('./payroll.routes'));
router.use('/attendance', require('./attendance.routes'));
router.use('/holidays', require('./holiday.routes'));
router.use('/timetable', require('./timetable.routes'));
router.use('/exams', require('./exam.routes'));
router.use('/transport', require('./transport.routes'));
router.use('/reports', require('./report.routes'));

module.exports = router;
