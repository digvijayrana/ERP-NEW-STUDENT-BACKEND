const Teacher = require('../models/Teacher');
const asyncHandler = require('../middleware/asyncHandler');
const { uploadDocument } = require('../services/documentStorage.service');
const { HTTP_STATUS, ROLES } = require('../constants');

exports.create = asyncHandler(async (req, res) => {
  res.status(HTTP_STATUS.CREATED).json(await Teacher.create(req.body));
});

exports.list = asyncHandler(async (req, res) => {
  const filter = req.user.role === ROLES.TEACHER ? { _id: req.user.teacher } : {};
  res.json(await Teacher.find(filter).sort({ firstName: 1 }));
});

exports.get = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.TEACHER && req.user.teacher?.toString() !== req.params.id) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Teachers can only access their own staff profile' });
  }
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });
  res.json(teacher);
});

exports.update = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });
  res.json(teacher);
});

exports.remove = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findByIdAndDelete(req.params.id);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });
  res.json({ deleted: true });
});

exports.uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Document file is required' });
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });

  const docType = req.body.type || 'idProof';
  const stored = await uploadDocument(req.file, 'teachers/documents');
  const docEntry = { url: stored.fileUrl, originalName: req.file.originalname, uploadedAt: new Date(), status: 'pending', rejectReason: '' };

  if (docType === 'idProof') {
    teacher.documents = teacher.documents || {};
    teacher.documents.idProof = docEntry;
  } else if (docType === 'resume') {
    teacher.documents = teacher.documents || {};
    teacher.documents.resume = docEntry;
  } else {
    teacher.documents = teacher.documents || {};
    teacher.documents.certificates = teacher.documents.certificates || [];
    teacher.documents.certificates.push(docEntry);
  }

  await teacher.save();
  res.status(HTTP_STATUS.CREATED).json(teacher.documents);
});

exports.selfUpdate = asyncHandler(async (req, res) => {
  const teacherId = req.user.teacher;
  if (!teacherId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'No teacher linked to this account' });

  const allowed = ['experience', 'education', 'qualification', 'email', 'phone'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const teacher = await Teacher.findByIdAndUpdate(teacherId, updates, { new: true, runValidators: true });
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });
  res.json(teacher);
});

exports.selfUploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Document file is required' });
  const teacherId = req.user.teacher;
  if (!teacherId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'No teacher linked to this account' });

  const teacher = await Teacher.findById(teacherId);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });

  const docType = req.body.type || 'idProof';
  const stored = await uploadDocument(req.file, 'teachers/documents');
  const docEntry = { url: stored.fileUrl, originalName: req.file.originalname, uploadedAt: new Date(), status: 'pending', rejectReason: '' };

  teacher.documents = teacher.documents || {};
  if (docType === 'idProof') {
    teacher.documents.idProof = docEntry;
  } else if (docType === 'resume') {
    teacher.documents.resume = docEntry;
  } else {
    teacher.documents.certificates = teacher.documents.certificates || [];
    teacher.documents.certificates.push(docEntry);
  }

  await teacher.save();
  res.status(HTTP_STATUS.CREATED).json(teacher.documents);
});

exports.verifyDocument = asyncHandler(async (req, res) => {
  const { docType, action, reason } = req.body;
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Teacher not found' });

  teacher.documents = teacher.documents || {};
  const status = action === 'approve' ? 'approved' : 'rejected';
  const rejectReason = action === 'reject' ? (reason || 'Please reupload with correct document') : '';

  if (docType === 'idProof' && teacher.documents.idProof) {
    teacher.documents.idProof.status = status;
    teacher.documents.idProof.rejectReason = rejectReason;
  } else if (docType === 'resume' && teacher.documents.resume) {
    teacher.documents.resume.status = status;
    teacher.documents.resume.rejectReason = rejectReason;
  }

  await teacher.save();
  res.json({ message: `Document ${status}`, documents: teacher.documents });
});
