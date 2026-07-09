const router = require('express').Router();
const controller = require('../controllers/attendance.controller');
const { requirePermission, authorize } = require('../middleware/auth');

router.get('/', authorize('admin', 'teacher', 'student', 'parent'), controller.list);
router.get('/register', requirePermission('attendance', 'view'), controller.getRegister);
router.post('/register/save', requirePermission('attendance', 'create'), controller.saveRegister);
router.post('/register/submit', requirePermission('attendance', 'edit'), controller.submitRegister);
router.post('/register/lock', requirePermission('attendance', 'edit'), controller.lockRegister);
router.post('/register/unlock', authorize('admin', 'super_admin'), controller.unlockRegister);
router.get('/summary/:studentId', requirePermission('attendance', 'view'), controller.summary);
router.get('/reports/:type', requirePermission('attendance', 'view'), controller.getReport);
router.get('/reports/:type/pdf', requirePermission('attendance', 'export'), controller.downloadReportPdf);
router.get('/students', requirePermission('attendance', 'view'), controller.studentOptions);
router.get('/self-status', authorize('teacher'), controller.selfStatus);
router.post('/mark', requirePermission('attendance', 'create'), controller.mark);
router.post('/self-mark', authorize('teacher'), controller.selfMark);

module.exports = router;
