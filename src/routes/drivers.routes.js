const router = require('express').Router();
const vehicleController = require('../controllers/vehicle.controller');
const driverSalaryController = require('../controllers/driverSalary.controller');
const { drivers, vehicleUpload, vehicleDocumentFileAccess } = require('../middleware');

router.get('/vehicles', drivers.view, vehicleController.list);
router.get('/vehicles/:id', drivers.view, vehicleController.get);
router.get('/vehicles/:id/documents/:docType/file', vehicleDocumentFileAccess, vehicleController.streamDocument);
router.post('/vehicles', drivers.create, vehicleUpload, vehicleController.create);
router.patch('/vehicles/:id', drivers.edit, vehicleUpload, vehicleController.update);
router.post('/vehicles/:id/toggle-status', drivers.edit, vehicleController.toggleStatus);
router.delete('/vehicles/:id', drivers.deactivate, vehicleController.remove);

router.get('/driver-salaries/register', drivers.view, driverSalaryController.register);
router.get('/driver-salaries', drivers.view, driverSalaryController.history);
router.post('/driver-salaries', drivers.edit, driverSalaryController.pay);
router.delete('/driver-salaries/:id', drivers.edit, driverSalaryController.remove);

module.exports = router;
