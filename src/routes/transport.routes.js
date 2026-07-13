const router = require('express').Router();
const controller = require('../controllers/bus.controller');
const { requirePermission } = require('../middleware/auth');

// NOTE: Vehicles & driver-salary endpoints moved to the dedicated Drivers module (see drivers.routes.js).

router.get('/routes', requirePermission('transport', 'view'), controller.listRoutes);
router.post('/routes', requirePermission('transport', 'create'), controller.createRoute);
router.patch('/routes/:id', requirePermission('transport', 'edit'), controller.updateRoute);
router.post('/routes/:id/toggle-status', requirePermission('transport', 'edit'), controller.toggleRouteStatus);
router.delete('/routes/:id', requirePermission('transport', 'deactivate'), controller.deleteRoute);

router.get('/registrations', requirePermission('transport', 'view'), controller.listRegistrations);
router.get('/registrations/:id', requirePermission('transport', 'view'), controller.getRegistration);
router.post('/registrations', requirePermission('transport', 'create'), controller.createRegistration);
router.patch('/registrations/:id', requirePermission('transport', 'edit'), controller.updateRegistration);
router.post('/registrations/:id/deactivate', requirePermission('transport', 'edit'), controller.deactivateRegistration);

router.get('/reports/:type', requirePermission('transport', 'view'), controller.getReport);
router.get('/reports/:type/pdf', requirePermission('transport', 'export'), controller.downloadReportPdf);

module.exports = router;
