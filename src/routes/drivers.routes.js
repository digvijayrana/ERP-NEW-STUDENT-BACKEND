const router = require('express').Router();
const vehicleController = require('../controllers/vehicle.controller');
const driverSalaryController = require('../controllers/driverSalary.controller');
const { requirePermission } = require('../middleware/auth');
const upload = require('../middleware/upload');

const vehicleUpload = upload.fields([
  { name: 'driverPhoto', maxCount: 1 },
  { name: 'driverAadhaar', maxCount: 1 },
  { name: 'driverLicensePhoto', maxCount: 1 }
]);

// Vehicles & drivers
router.get('/vehicles', requirePermission('drivers', 'view'), vehicleController.list);
router.get('/vehicles/:id', requirePermission('drivers', 'view'), vehicleController.get);
router.get('/vehicles/:id/documents/:docType/file', requirePermission('drivers', 'view'), vehicleController.streamDocument);
router.post('/vehicles', requirePermission('drivers', 'create'), vehicleUpload, vehicleController.create);
router.patch('/vehicles/:id', requirePermission('drivers', 'edit'), vehicleUpload, vehicleController.update);
router.post('/vehicles/:id/toggle-status', requirePermission('drivers', 'edit'), vehicleController.toggleStatus);
router.delete('/vehicles/:id', requirePermission('drivers', 'deactivate'), vehicleController.remove);

// Driver salaries
router.get('/driver-salaries/register', requirePermission('drivers', 'view'), driverSalaryController.register);
router.get('/driver-salaries', requirePermission('drivers', 'view'), driverSalaryController.history);
router.post('/driver-salaries', requirePermission('drivers', 'edit'), driverSalaryController.pay);
router.delete('/driver-salaries/:id', requirePermission('drivers', 'edit'), driverSalaryController.remove);

module.exports = router;
