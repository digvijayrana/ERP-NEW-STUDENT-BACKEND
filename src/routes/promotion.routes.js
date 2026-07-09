const router = require('express').Router();
const controller = require('../controllers/promotion.controller');
const { requirePermission } = require('../middleware/auth');

router.get('/eligible', requirePermission('students', 'view'), controller.eligible);
router.post('/preview', requirePermission('students', 'edit'), controller.preview);
router.post('/execute', requirePermission('students', 'edit'), controller.execute);
router.get('/reports/:type', requirePermission('students', 'view'), controller.report);
router.get('/batches/:id', requirePermission('students', 'view'), controller.getBatch);
router.post('/batches/:id/rollback', requirePermission('students', 'edit'), controller.rollback);
router.post('/batches/:id/finalize', requirePermission('students', 'approve'), controller.finalize);

module.exports = router;
