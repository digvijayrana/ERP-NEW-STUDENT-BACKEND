const router = require('express').Router();
const controller = require('../controllers/teacher.controller');
const { authorize, requirePermission } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.post('/', requirePermission('teachers', 'create'), controller.create);
router.get('/', requirePermission('teachers', 'view'), controller.list);
router.patch('/self', authorize('teacher'), controller.selfUpdate);
router.post('/self/documents', authorize('teacher'), upload.single('document'), controller.selfUploadDocument);
router.get('/:id', requirePermission('teachers', 'view'), controller.get);
router.patch('/:id', requirePermission('teachers', 'edit'), controller.update);
router.delete('/:id', requirePermission('teachers', 'deactivate'), controller.remove);
router.post('/:id/documents', requirePermission('teachers', 'edit'), upload.single('document'), controller.uploadDocument);
router.get('/:id/documents/:docType/file', requirePermission('teachers', 'view'), controller.streamDocument);
router.get('/:id/documents/:docType/url', requirePermission('teachers', 'view'), controller.getDocumentUrl);
router.post('/:id/verify-document', requirePermission('teachers', 'approve'), controller.verifyDocument);

module.exports = router;
