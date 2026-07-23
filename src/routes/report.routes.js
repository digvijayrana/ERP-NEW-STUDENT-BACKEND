const router = require('express').Router();
const controller = require('../controllers/report.controller');
const { reports, reportReadOnlyGuard } = require('../middleware');

router.use(reportReadOnlyGuard);
router.get('/types', reports.view, controller.listReportTypes);
router.get('/:domain/:type/csv', reports.export, controller.downloadReportCsv);
router.get('/:domain/:type/pdf', reports.export, controller.downloadReportPdf);
router.get('/:domain/:type', reports.view, controller.getReport);

module.exports = router;
