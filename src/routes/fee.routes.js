const router = require('express').Router();
const controller = require('../controllers/fee.controller');
const structureController = require('../controllers/feeStructure.controller');
const { fees } = require('../middleware');

router.get('/structures', fees.view, structureController.list);
router.get('/structures/for-class', fees.view, structureController.getForClass);
router.put('/structures', fees.create, structureController.upsert);
router.delete('/structures/:id', fees.create, structureController.remove);

router.post('/demands/generate', fees.create, controller.generateDemands);
router.post('/invoices', fees.create, controller.createInvoice);
router.post('/invoices/bulk-monthly', fees.create, controller.createBulkMonthlyInvoices);
router.get('/summary', fees.view, controller.summary);
router.get('/invoices/preview', fees.view, controller.previewDemand);
router.get('/invoices', fees.view, controller.listInvoices);
router.get('/invoices/:id', fees.view, controller.getInvoice);
router.patch('/invoices/:id', fees.edit, controller.updateInvoice);
router.post('/invoices/:id/payments', fees.edit, controller.addPayment);
router.post('/invoices/:id/payments/:paymentId/void', fees.edit, controller.voidPayment);
router.post('/invoices/:id/payments/:paymentId/unlock', fees.unlock, controller.unlockPayment);
router.get('/history', fees.view, controller.feeHistory);
router.get('/invoices/:id/pdf', fees.view, controller.downloadInvoice);
router.get('/invoices/:id/receipts/:paymentId/pdf', fees.view, controller.downloadReceipt);

module.exports = router;
