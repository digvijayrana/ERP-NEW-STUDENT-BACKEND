const router = require('express').Router();
const controller = require('../controllers/bus.controller');
const { transport } = require('../middleware');

// Vehicles & driver-salary endpoints live in drivers.routes.js.

router.get('/routes', transport.view, controller.listRoutes);
router.post('/routes', transport.create, controller.createRoute);
router.patch('/routes/:id', transport.edit, controller.updateRoute);
router.post('/routes/:id/toggle-status', transport.edit, controller.toggleRouteStatus);
router.delete('/routes/:id', transport.deactivate, controller.deleteRoute);

router.get('/registrations', transport.view, controller.listRegistrations);
router.get('/registrations/:id', transport.view, controller.getRegistration);
router.post('/registrations', transport.create, controller.createRegistration);
router.patch('/registrations/:id', transport.edit, controller.updateRegistration);
router.post('/registrations/:id/deactivate', transport.edit, controller.deactivateRegistration);

router.get('/reports/:type', transport.view, controller.getReport);
router.get('/reports/:type/pdf', transport.export, controller.downloadReportPdf);

module.exports = router;
