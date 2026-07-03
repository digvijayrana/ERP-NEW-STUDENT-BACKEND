const multer = require('multer');
const { UPLOAD } = require('../constants');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD.MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    cb(null, UPLOAD.ALLOWED_MIME_TYPES.includes(file.mimetype));
  }
});

module.exports = upload;
