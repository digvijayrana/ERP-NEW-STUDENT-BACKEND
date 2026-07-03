const router = require('express').Router();
const controller = require('../controllers/fee.controller');
const { authorize } = require('../middleware/auth');

router.post('/invoices', authorize('admin'), controller.createInvoice);
router.post('/invoices/bulk-monthly', authorize('admin'), controller.createBulkMonthlyInvoices);
router.get('/invoices', authorize('admin', 'student', 'parent'), controller.listInvoices);
router.post('/invoices/:id/payments', authorize('admin'), controller.addPayment);
router.get('/invoices/:id/pdf', authorize('admin', 'student', 'parent'), controller.downloadInvoice);

module.exports = router;
