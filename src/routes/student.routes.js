const router = require('express').Router();
const controller = require('../controllers/student.controller');
const { requirePermission } = require('../middleware/auth');
const upload = require('../middleware/upload');

const admissionUpload = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'aadhaar', maxCount: 1 },
  { name: 'birthCertificate', maxCount: 1 },
  { name: 'otherDocuments', maxCount: 10 }
]);

/** Allow JWT+permission, or a valid signed document accessToken for this file. */
const studentDocumentFileAccess = (req, res, next) => {
  const entry = req.documentAccessEntry;
  if (
    entry
    && entry.resourceType === 'student'
    && entry.resourceId === String(req.params.id)
    && entry.documentId === String(req.params.documentId)
  ) {
    return next();
  }
  return requirePermission('students', 'view')(req, res, next);
};

router.post('/admissions', requirePermission('students', 'create'), admissionUpload, controller.createAdmission);
router.post('/promotions', requirePermission('students', 'edit'), controller.promote);
router.get('/', requirePermission('students', 'view'), controller.list);
router.get('/parents/search', requirePermission('students', 'view'), controller.searchParents);
router.get('/:id/profile', requirePermission('students', 'view'), require('../controllers/studentProfile.controller').getProfile);
router.get('/:id', requirePermission('students', 'view'), controller.get);
router.patch('/:id', requirePermission('students', 'edit'), controller.update);
router.patch('/:id/status', requirePermission('students', 'edit'), controller.updateStatus);
router.delete('/:id', requirePermission('students', 'deactivate'), controller.remove);
router.post('/:id/documents', requirePermission('students', 'edit'), upload.single('document'), controller.addDocument);
router.put('/:id/documents/:documentId', requirePermission('students', 'edit'), upload.single('document'), controller.replaceDocument);
router.delete('/:id/documents/:documentId', requirePermission('students', 'edit'), controller.deleteDocument);
router.get('/:id/documents/:documentId/file', studentDocumentFileAccess, controller.streamDocument);
router.get('/:id/documents/:documentId/url', requirePermission('students', 'view'), controller.getDocumentUrl);
router.post('/:id/verify-document', requirePermission('students', 'approve'), controller.verifyDocument);

module.exports = router;
