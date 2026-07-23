const router = require('express').Router();
const controller = require('../controllers/student.controller');
const {
  students,
  admissionUpload,
  singleDocument,
  studentDocumentFileAccess,
  requireStudentAccess
} = require('../middleware');

router.post('/admissions', students.create, admissionUpload, controller.createAdmission);
router.post('/promotions', students.edit, controller.promote);
router.get('/', students.view, controller.list);
router.get('/parents/search', students.view, controller.searchParents);
router.get('/:id/profile', students.view, requireStudentAccess, require('../controllers/studentProfile.controller').getProfile);
router.get('/:id', students.view, requireStudentAccess, controller.get);
router.patch('/:id', students.edit, controller.update);
router.patch('/:id/status', students.edit, controller.updateStatus);
router.delete('/:id', students.deactivate, controller.remove);
router.post('/:id/documents', students.edit, singleDocument, controller.addDocument);
router.put('/:id/documents/:documentId', students.edit, singleDocument, controller.replaceDocument);
router.delete('/:id/documents/:documentId', students.edit, controller.deleteDocument);
router.get('/:id/documents/:documentId/file', studentDocumentFileAccess, controller.streamDocument);
router.get('/:id/documents/:documentId/url', students.view, controller.getDocumentUrl);
router.post('/:id/verify-document', students.approve, controller.verifyDocument);

module.exports = router;
