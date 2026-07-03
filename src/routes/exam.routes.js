const router = require('express').Router();
const controller = require('../controllers/exam.controller');
const { authorize } = require('../middleware/auth');

router.get('/', authorize('admin', 'teacher', 'student', 'parent'), controller.list);
router.get('/results', authorize('admin', 'teacher', 'student', 'parent'), controller.results);
router.get('/:id/report', authorize('admin', 'teacher'), controller.classReport);
router.get('/:id', authorize('admin', 'teacher', 'student', 'parent'), controller.getById);
router.post('/generate', authorize('admin', 'teacher'), controller.generate);
router.patch('/:id', authorize('admin', 'teacher'), controller.update);
router.post('/:id/publish', authorize('admin', 'teacher'), controller.publish);
router.post('/:id/close', authorize('admin', 'teacher'), controller.close);
router.post('/:id/start', authorize('student'), controller.startAttempt);
router.post('/:id/submit', authorize('student'), controller.submitAttempt);
router.delete('/:id', authorize('admin', 'teacher'), controller.deleteExam);

module.exports = router;
