const router = require('express').Router();
const controller = require('../controllers/report.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/types', requirePermission('reports', 'view'), controller.listReportTypes);
router.get('/:domain/:type', requirePermission('reports', 'view'), controller.getReport);
router.get('/:domain/:type/pdf', requirePermission('reports', 'export'), controller.downloadReportPdf);

module.exports = router;
