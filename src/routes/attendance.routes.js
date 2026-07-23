const router = require('express').Router();
const controller = require('../controllers/attendance.controller');
const { attendance, roles } = require('../middleware');

router.get('/', roles.schoolUsers, controller.list);
router.get('/register', attendance.view, controller.getRegister);
router.post('/register/save', attendance.create, controller.saveRegister);
router.post('/register/submit', attendance.edit, controller.submitRegister);
router.post('/register/lock', attendance.edit, controller.lockRegister);
router.post('/register/unlock', attendance.unlock, controller.unlockRegister);
router.get('/summary/:studentId', attendance.view, controller.summary);
router.get('/reports/:type', attendance.view, controller.getReport);
router.get('/reports/:type/pdf', attendance.export, controller.downloadReportPdf);
router.get('/students', attendance.view, controller.studentOptions);
router.get('/self-status', roles.teacher, controller.selfStatus);
router.post('/mark', attendance.create, controller.mark);
router.post('/self-mark', roles.teacher, controller.selfMark);

module.exports = router;
