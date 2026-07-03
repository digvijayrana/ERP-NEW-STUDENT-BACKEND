const router = require('express').Router();
const controller = require('../controllers/student.controller');
const { authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

const admissionUpload = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'aadhaar', maxCount: 1 },
  { name: 'birthCertificate', maxCount: 1 },
  { name: 'otherDocuments', maxCount: 10 }
]);

router.post('/admissions', authorize('admin'), admissionUpload, controller.createAdmission);
router.post('/promotions', authorize('admin'), controller.promote);
router.get('/', authorize('admin', 'teacher', 'student', 'parent'), controller.list);
router.get('/:id/profile', authorize('admin', 'teacher', 'student', 'parent'), require('../controllers/studentProfile.controller').getProfile);
router.get('/:id', authorize('admin', 'teacher', 'student', 'parent'), controller.get);
router.patch('/:id', authorize('admin'), controller.update);
router.delete('/:id', authorize('admin'), controller.remove);
router.post('/:id/documents', authorize('admin'), upload.single('document'), controller.addDocument);

module.exports = router;
