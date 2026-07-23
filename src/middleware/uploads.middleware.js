const upload = require('./upload');

const admissionUpload = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'aadhaar', maxCount: 1 },
  { name: 'birthCertificate', maxCount: 1 },
  { name: 'otherDocuments', maxCount: 10 }
]);

const vehicleUpload = upload.fields([
  { name: 'driverPhoto', maxCount: 1 },
  { name: 'driverAadhaar', maxCount: 1 },
  { name: 'driverLicensePhoto', maxCount: 1 }
]);

const singleDocument = upload.single('document');
const chapterPdf = upload.single('chapterPdf');

module.exports = {
  upload,
  admissionUpload,
  vehicleUpload,
  singleDocument,
  chapterPdf
};
