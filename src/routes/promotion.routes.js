const router = require('express').Router();
const controller = require('../controllers/promotion.controller');
const { students } = require('../middleware');

router.get('/eligible', students.view, controller.eligible);
router.post('/preview', students.edit, controller.preview);
router.post('/execute', students.edit, controller.execute);
router.get('/reports/:type', students.view, controller.report);
router.get('/batches/:id', students.view, controller.getBatch);
router.post('/batches/:id/rollback', students.edit, controller.rollback);
router.post('/batches/:id/finalize', students.approve, controller.finalize);

module.exports = router;
