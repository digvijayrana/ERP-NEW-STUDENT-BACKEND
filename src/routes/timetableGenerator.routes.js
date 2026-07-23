const router = require('express').Router();
const controller = require('../controllers/timetableGenerator.controller');
const { timetable_generator: tg } = require('../middleware');

router.get('/dashboard', tg.view, controller.dashboard);
router.get('/plans', tg.view, controller.listPlans);
router.get('/plans/:id', tg.view, controller.getPlan);
router.put('/plans/:id/config', tg.edit, controller.updateConfig);
router.post('/generate', tg.create, controller.generate);
router.post('/plans/:id/generate', tg.create, controller.generate);
router.post('/plans/:id/validate', tg.view, controller.validate);
router.post('/plans/:id/move', tg.edit, controller.moveSlot);
router.post('/plans/:id/reopen', tg.edit, controller.reopenForEdit);
router.post('/plans/:id/reset', tg.edit, controller.resetPlan);
router.post('/plans/:id/slots', tg.edit, controller.assignSlot);
router.patch('/plans/:id/slots/:slotId', tg.edit, controller.updateSlot);
router.post('/plans/:id/slots/:slotId', tg.edit, controller.updateSlot);
router.post('/plans/:id/apply', tg.approve, controller.apply);
router.get('/plans/:id/pdf', tg.print, controller.exportPdf);

module.exports = router;
