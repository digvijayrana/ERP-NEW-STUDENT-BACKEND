const router = require('express').Router();
const controller = require('../controllers/teacher.controller');
const { authorize, requirePermission } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { ROLES } = require('../constants');

// Teachers may read their OWN documents (ownership is enforced inside the
// controller). Any other role must hold the teachers:view permission.
// Signed document URLs (?accessToken=) skip role checks after token match.
const teacherDocumentReadAccess = (req, res, next) => {
  const entry = req.documentAccessEntry;
  if (
    entry
    && entry.resourceType === 'teacher'
    && entry.resourceId === String(req.params.id)
    && (!req.params.docType || entry.documentId === String(req.params.docType))
  ) {
    return next();
  }
  if (req.user && req.user.role === ROLES.TEACHER) return next();
  return requirePermission('teachers', 'view')(req, res, next);
};

router.post('/', requirePermission('teachers', 'create'), controller.create);
router.get('/', requirePermission('teachers', 'view'), controller.list);
router.patch('/self', authorize('teacher'), controller.selfUpdate);
router.post('/self/documents', authorize('teacher'), upload.single('document'), controller.selfUploadDocument);
router.get('/:id', requirePermission('teachers', 'view'), controller.get);
router.patch('/:id', requirePermission('teachers', 'edit'), controller.update);
router.delete('/:id', requirePermission('teachers', 'deactivate'), controller.remove);
router.post('/:id/documents', requirePermission('teachers', 'edit'), upload.single('document'), controller.uploadDocument);
router.get('/:id/documents/:docType/file', teacherDocumentReadAccess, controller.streamDocument);
router.get('/:id/documents/:docType/url', teacherDocumentReadAccess, controller.getDocumentUrl);
router.get('/:id/entries/:section/:index/file', teacherDocumentReadAccess, controller.streamEntryDocument);
router.post('/:id/verify-document', requirePermission('teachers', 'approve'), controller.verifyDocument);

module.exports = router;
