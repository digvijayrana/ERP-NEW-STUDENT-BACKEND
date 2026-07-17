const router = require('express').Router();
const controller = require('../controllers/timetableGenerator.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/dashboard', requirePermission('timetable_generator', 'view'), controller.dashboard);
router.get('/plans', requirePermission('timetable_generator', 'view'), controller.listPlans);
router.get('/plans/:id', requirePermission('timetable_generator', 'view'), controller.getPlan);
router.put('/plans/:id/config', requirePermission('timetable_generator', 'edit'), controller.updateConfig);
router.post('/generate', requirePermission('timetable_generator', 'create'), controller.generate);
router.post('/plans/:id/generate', requirePermission('timetable_generator', 'create'), controller.generate);
router.post('/plans/:id/validate', requirePermission('timetable_generator', 'view'), controller.validate);
router.post('/plans/:id/move', requirePermission('timetable_generator', 'edit'), controller.moveSlot);
router.post('/plans/:id/apply', requirePermission('timetable_generator', 'approve'), controller.apply);
router.get('/plans/:id/pdf', requirePermission('timetable_generator', 'print'), controller.exportPdf);

module.exports = router;
