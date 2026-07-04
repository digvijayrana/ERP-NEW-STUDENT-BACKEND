const Admission = require('../models/Admission');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const asyncHandler = require('../middleware/asyncHandler');
const { uploadDocument } = require('../services/documentStorage.service');
const { nextAdmissionNumber } = require('../services/sequence.service');
const { HTTP_STATUS, ROLES } = require('../constants');

async function fileToDocument(file, type, title, folder) {
  const stored = await uploadDocument(file, folder);
  return {
    type,
    title: title || file.originalname,
    ...stored
  };
}

exports.createAdmission = asyncHandler(async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.data || '{}');
  } catch {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Invalid admission payload' });
  }

  const files = req.files || {};
  const documents = [];
  if (files.photo?.[0]) documents.push(await fileToDocument(files.photo[0], 'photo', 'Student photo', 'students/photos'));
  if (files.aadhaar?.[0]) documents.push(await fileToDocument(files.aadhaar[0], 'aadhaar', 'Aadhaar card', 'students/aadhaar'));
  if (files.birthCertificate?.[0]) {
    documents.push(await fileToDocument(files.birthCertificate[0], 'birth_certificate', 'Birth certificate', 'students/birth-certificates'));
  }
  for (const file of files.otherDocuments || []) {
    documents.push(await fileToDocument(file, 'other', file.originalname, 'students/other-documents'));
  }

  const createdStudent = await Student.create({
    ...(payload.student || {}),
    admissionNumber: await nextAdmissionNumber(),
    guardians: payload.guardians || [],
    previousSchoolDetails: payload.previousSchoolDetails || undefined,
    documents,
    enrollments: [
      {
        academicYear: payload.academicYear,
        classRoom: payload.classRoom,
        rollNumber: payload.rollNumber
      }
    ]
  });

  try {
    await Admission.create({
      student: createdStudent._id,
      academicYear: payload.academicYear,
      classRoom: payload.classRoom,
      admissionType: payload.admissionType || 'new',
      previousSchool: payload.previousSchool,
      notes: payload.notes
    });
  } catch (error) {
    await Student.deleteOne({ _id: createdStudent._id });
    throw error;
  }

  res.status(HTTP_STATUS.CREATED).json(createdStudent);
});

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.classRoom) filter['enrollments.classRoom'] = req.query.classRoom;
  if (req.query.status) filter.status = req.query.status;
  if (req.user.role === ROLES.STUDENT) filter._id = req.user.student;
  if (req.user.role === ROLES.PARENT) {
    const childIds = req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : []);
    filter._id = { $in: childIds };
  }
  if (req.user.role === ROLES.TEACHER) {
    const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
    filter['enrollments.classRoom'] = { $in: classIds };
  }

  const students = await Student.find(filter)
    .populate('enrollments.academicYear', 'name')
    .populate('enrollments.classRoom', 'name section')
    .sort({ createdAt: -1 });
  res.json(students);
});

exports.get = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.STUDENT && req.user.student?.toString() !== req.params.id) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Students can only access their own profile' });
  }
  if (req.user.role === ROLES.PARENT) {
    const childIds = (req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : [])).map(String);
    if (!childIds.includes(req.params.id)) return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Parents can only access their linked child profile' });
  }

  const student = await Student.findById(req.params.id)
    .populate('enrollments.academicYear', 'name')
    .populate('enrollments.classRoom', 'name section classTeacher')
    .populate('enrollments.classRoom.classTeacher', 'firstName lastName');
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });
  if (req.user.role === ROLES.TEACHER) {
    const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
    const canAccess = student.enrollments.some((enrollment) => classIds.some((id) => id.equals(enrollment.classRoom?._id || enrollment.classRoom)));
    if (!canAccess) return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'Teacher can only access assigned class students' });
  }
  res.json(student);
});

exports.update = asyncHandler(async (req, res) => {
  const student = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });
  res.json(student);
});

exports.remove = asyncHandler(async (req, res) => {
  const student = await Student.findByIdAndUpdate(req.params.id, { status: 'inactive' }, { new: true });
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });
  res.json({ deleted: true });
});

exports.addDocument = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Document file is required' });
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  student.documents.push(await fileToDocument(req.file, req.body.type || 'other', req.body.title, 'students/documents'));
  await student.save();
  res.status(HTTP_STATUS.CREATED).json(student.documents.at(-1));
});

exports.promote = asyncHandler(async (req, res) => {
  const { studentIds, fromAcademicYear, toAcademicYear, toClassRoom } = req.body;
  if (!studentIds?.length || !fromAcademicYear || !toAcademicYear || !toClassRoom) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'studentIds, fromAcademicYear, toAcademicYear and toClassRoom are required' });
  }

  const result = await Student.updateMany(
    {
      _id: { $in: studentIds },
      enrollments: { $elemMatch: { academicYear: fromAcademicYear, status: 'studying' } }
    },
    {
      $set: {
        'enrollments.$[current].status': 'promoted',
        'enrollments.$[current].toDate': new Date()
      },
      $push: {
        enrollments: {
          academicYear: toAcademicYear,
          classRoom: toClassRoom,
          status: 'studying',
          fromDate: new Date()
        }
      }
    },
    {
      arrayFilters: [{ 'current.academicYear': fromAcademicYear, 'current.status': 'studying' }]
    }
  );

  res.json({ promoted: result.modifiedCount });
});

exports.verifyDocument = asyncHandler(async (req, res) => {
  const { documentId, action, reason } = req.body;
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const doc = student.documents.id(documentId);
  if (!doc) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Document not found' });

  doc.status = action === 'approve' ? 'approved' : 'rejected';
  doc.rejectReason = action === 'reject' ? (reason || 'Please reupload with correct document') : '';
  await student.save();

  res.json({ message: `Document ${doc.status}`, documents: student.documents });
});
