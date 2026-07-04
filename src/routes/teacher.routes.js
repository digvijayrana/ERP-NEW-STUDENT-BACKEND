const router = require('express').Router();
const controller = require('../controllers/teacher.controller');
const { authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.post('/', authorize('admin'), controller.create);
router.get('/', authorize('admin', 'teacher'), controller.list);
router.patch('/self', authorize('teacher'), controller.selfUpdate);
router.post('/self/documents', authorize('teacher'), upload.single('document'), controller.selfUploadDocument);
router.get('/:id', authorize('admin', 'teacher'), controller.get);
router.patch('/:id', authorize('admin'), controller.update);
router.delete('/:id', authorize('admin'), controller.remove);
router.post('/:id/documents', authorize('admin'), upload.single('document'), controller.uploadDocument);
router.post('/:id/verify-document', authorize('admin'), controller.verifyDocument);

module.exports = router;
