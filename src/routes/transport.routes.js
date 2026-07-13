const router = require('express').Router();
const controller = require('../controllers/bus.controller');
const vehicleController = require('../controllers/vehicle.controller');
const driverSalaryController = require('../controllers/driverSalary.controller');
const { requirePermission } = require('../middleware/auth');
const upload = require('../middleware/upload');

const vehicleUpload = upload.fields([
  { name: 'driverPhoto', maxCount: 1 },
  { name: 'driverAadhaar', maxCount: 1 },
  { name: 'driverLicensePhoto', maxCount: 1 }
]);

router.get('/vehicles', requirePermission('transport', 'view'), vehicleController.list);
router.get('/vehicles/:id', requirePermission('transport', 'view'), vehicleController.get);
router.get('/vehicles/:id/documents/:docType/file', requirePermission('transport', 'view'), vehicleController.streamDocument);
router.post('/vehicles', requirePermission('transport', 'create'), vehicleUpload, vehicleController.create);
router.patch('/vehicles/:id', requirePermission('transport', 'edit'), vehicleUpload, vehicleController.update);
router.post('/vehicles/:id/toggle-status', requirePermission('transport', 'edit'), vehicleController.toggleStatus);
router.delete('/vehicles/:id', requirePermission('transport', 'deactivate'), vehicleController.remove);

router.get('/driver-salaries/register', requirePermission('transport', 'view'), driverSalaryController.register);
router.get('/driver-salaries', requirePermission('transport', 'view'), driverSalaryController.history);
router.post('/driver-salaries', requirePermission('transport', 'edit'), driverSalaryController.pay);
router.delete('/driver-salaries/:id', requirePermission('transport', 'edit'), driverSalaryController.remove);

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
