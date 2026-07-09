const router = require('express').Router();
const controller = require('../controllers/fee.controller');
const { requirePermission, requireSuperAdmin } = require('../middleware/auth');

router.post('/demands/generate', requirePermission('fees', 'create'), controller.generateDemands);
router.post('/invoices', requirePermission('fees', 'create'), controller.createInvoice);
router.post('/invoices/bulk-monthly', requirePermission('fees', 'create'), controller.createBulkMonthlyInvoices);
router.get('/invoices/preview', requirePermission('fees', 'view'), controller.previewDemand);
router.get('/invoices', requirePermission('fees', 'view'), controller.listInvoices);
router.get('/invoices/:id', requirePermission('fees', 'view'), controller.getInvoice);
router.patch('/invoices/:id', requirePermission('fees', 'edit'), controller.updateInvoice);
router.post('/invoices/:id/payments', requirePermission('fees', 'edit'), controller.addPayment);
router.post('/invoices/:id/payments/:paymentId/void', requirePermission('fees', 'edit'), controller.voidPayment);
router.post('/invoices/:id/payments/:paymentId/unlock', requireSuperAdmin, controller.unlockPayment);
router.get('/history', requirePermission('fees', 'view'), controller.feeHistory);
router.get('/invoices/:id/pdf', requirePermission('fees', 'view'), controller.downloadInvoice);
router.get('/invoices/:id/receipts/:paymentId/pdf', requirePermission('fees', 'view'), controller.downloadReceipt);

module.exports = router;
