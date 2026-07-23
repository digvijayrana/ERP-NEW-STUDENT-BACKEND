const router = require('express').Router();
const controller = require('../controllers/exam.controller');
const { roles, chapterPdf } = require('../middleware');

router.get('/', roles.schoolUsers, controller.list);
router.get('/results', roles.schoolUsers, controller.results);
router.get('/:id/report', roles.staff, controller.classReport);
router.get('/:id', roles.schoolUsers, controller.getById);
router.post('/generate', roles.staff, controller.generate);
router.post('/generate-from-pdf', roles.staff, chapterPdf, controller.generateFromPdf);
router.patch('/:id', roles.staff, controller.update);
router.post('/:id/publish', roles.staff, controller.publish);
router.post('/:id/close', roles.staff, controller.close);
router.post('/:id/start', roles.student, controller.startAttempt);
router.post('/:id/submit', roles.student, controller.submitAttempt);
router.delete('/:id', roles.staff, controller.deleteExam);

module.exports = router;
