const router = require('express').Router();
const controller = require('../controllers/teacher.controller');
const {
  teachers,
  roles,
  singleDocument,
  teacherDocumentReadAccess,
  requireTeacherSelfAccess
} = require('../middleware');

router.post('/', teachers.create, controller.create);
router.get('/', teachers.view, controller.list);
router.patch('/self', roles.teacher, controller.selfUpdate);
router.post('/self/documents', roles.teacher, singleDocument, controller.selfUploadDocument);
router.get('/:id', teachers.view, requireTeacherSelfAccess, controller.get);
router.patch('/:id', teachers.edit, controller.update);
router.delete('/:id', teachers.deactivate, controller.remove);
router.post('/:id/documents', teachers.edit, singleDocument, controller.uploadDocument);
router.get('/:id/documents/:docType/file', teacherDocumentReadAccess, controller.streamDocument);
router.get('/:id/documents/:docType/url', teacherDocumentReadAccess, controller.getDocumentUrl);
router.get('/:id/entries/:section/:index/file', teacherDocumentReadAccess, controller.streamEntryDocument);
router.post('/:id/verify-document', teachers.approve, controller.verifyDocument);

module.exports = router;
