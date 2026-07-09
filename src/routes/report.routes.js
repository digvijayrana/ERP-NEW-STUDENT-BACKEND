const router = require('express').Router();
const controller = require('../controllers/report.controller');
const { requirePermission } = require('../middleware/auth');
const { reportReadOnlyGuard } = require('../middleware/reportReadOnly');

router.use(reportReadOnlyGuard);
router.get('/types', requirePermission('reports', 'view'), controller.listReportTypes);
router.get('/:domain/:type/csv', requirePermission('reports', 'export'), controller.downloadReportCsv);
router.get('/:domain/:type/pdf', requirePermission('reports', 'export'), controller.downloadReportPdf);
router.get('/:domain/:type', requirePermission('reports', 'view'), controller.getReport);

module.exports = router;
