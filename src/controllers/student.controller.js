const Admission = require('../models/Admission');
const AcademicYear = require('../models/AcademicYear');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const User = require('../models/User');
const Parent = require('../models/Parent');
const asyncHandler = require('../middleware/asyncHandler');
const { uploadDocument, extractStorageKey, readDocument } = require('../services/documentStorage.service');
const { nextAdmissionNumber } = require('../services/sequence.service');
const { validateAdmission, buildActivityEntry } = require('../services/studentValidation.service');
const {
  ACTIONS,
  auditOnCreate,
  auditOnUpdate,
  buildStatusChangeEntry,
  logEntityCreate,
  logEntityUpdate,
  logStatusChange
} = require('../services/activityLog.service');
const { MODULES } = require('../constants/activityActions');
const { countStudentsInClass } = require('./classRoom.controller');
const { generateAdmissionDemand } = require('./fee.controller');
const { createLogger } = require('../utils/logger');
const { provisionStudentUser, provisionParentForGuardian } = require('../services/accountProvisioning.service');
const { HTTP_STATUS, ROLES, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');
const { assertOptimisticVersion } = require('../utils/optimisticLock');
const { invalidateNamespace } = require('../services/cache.service');
const { maskStudentRecord } = require('../utils/dataMasking');
const { logDocumentAccess } = require('../services/activityLog.service');
const { issueAccessToken, validateAccessToken, getAccessTtlSeconds, buildDocumentFileUrl } = require('../services/documentAccess.service');

const STUDENT_SORT_FIELDS = ['admissionNumber', 'firstName', 'admissionDate', 'status', 'createdAt'];

const log = createLogger('students');

async function linkStudentToParentUser(parentUserId, studentId) {
  if (!parentUserId) return;
  const user = await User.findById(parentUserId);
  if (!user || user.role !== ROLES.PARENT) {
    throw Object.assign(new Error('Selected parent account is invalid'), { statusCode: HTTP_STATUS.BAD_REQUEST });
  }
  const linked = (user.linkedStudents || []).map((id) => String(id));
  const studentKey = String(studentId);
  if (linked.includes(studentKey)) return;
  user.linkedStudents = [...(user.linkedStudents || []), studentId];
  if (!user.linkedStudent) user.linkedStudent = studentId;
  await user.save();
}

async function fileToDocument(file, type, title, folder) {
  const stored = await uploadDocument(file, folder);
  return {
    type,
    title: title || file.originalname,
    status: 'uploaded',
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
    const docType = payload.previousSchoolDetails ? 'transfer_certificate' : 'other';
    documents.push(await fileToDocument(file, docType, file.originalname, 'students/other-documents'));
  }

  const activeYear = await AcademicYear.findOne({ $or: [{ status: 'active' }, { isActive: true }] }).sort({ startDate: -1 });
  const academicYearId = payload.academicYear || activeYear?._id;
  if (!academicYearId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'No active academic year found. Please activate an academic year first.' });
  }

  if (!payload.classRoom) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Class selection is required for admission' });
  }

  const classRoom = await ClassRoom.findById(payload.classRoom);
  if (!classRoom) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Selected class not found' });
  }
  if (classRoom.status === 'inactive') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Selected class is inactive and cannot accept new admissions' });
  }
  if (String(classRoom.academicYear) !== String(academicYearId)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Selected class does not belong to the active academic year' });
  }

  const enrolledCount = await countStudentsInClass(classRoom._id, academicYearId);
  if (enrolledCount >= classRoom.capacity) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      message: `Class ${classRoom.name}-${classRoom.section} has reached maximum capacity (${classRoom.capacity})`,
      studentCount: enrolledCount,
      capacity: classRoom.capacity
    });
  }

  await validateAdmission({
    studentData: payload.student || {},
    guardians: payload.guardians || [],
    classRoom,
    academicYearId,
    rollNumber: payload.rollNumber,
    documents
  });

  const admissionEntry = buildActivityEntry(
    'admission',
    `Student admitted to ${classRoom.name}-${classRoom.section}`,
    req.user,
    { classRoom: classRoom._id, academicYear: academicYearId }
  );

  const createdStudent = await Student.create({
    ...(payload.student || {}),
    admissionNumber: await nextAdmissionNumber(),
    admissionDate: new Date(),
    status: 'active',
    guardians: payload.guardians || [],
    previousSchoolDetails: payload.previousSchoolDetails || undefined,
    documents,
    enrollments: [
      {
        academicYear: academicYearId,
        classRoom: payload.classRoom,
        rollNumber: payload.rollNumber,
        monthlyFee: classRoom.monthlyFee,
        status: 'studying'
      }
    ],
    activityLog: [admissionEntry],
    ...auditOnCreate(req.user)
  });

  logEntityCreate({
    module: MODULES.STUDENTS,
    entityId: createdStudent._id,
    entityLabel: createdStudent.admissionNumber,
    action: ACTIONS.ADMISSION,
    description: `Student admitted: ${createdStudent.firstName} ${createdStudent.lastName || ''}`.trim(),
    user: req.user,
    meta: {
      admissionNumber: createdStudent.admissionNumber,
      classRoom: classRoom._id,
      academicYear: academicYearId
    }
  });

  try {
    await Admission.create({
      student: createdStudent._id,
      academicYear: academicYearId,
      classRoom: payload.classRoom,
      admissionType: payload.admissionType || 'new',
      previousSchool: payload.previousSchool,
      notes: payload.notes
    });
  } catch (error) {
    await Student.deleteOne({ _id: createdStudent._id });
    throw error;
  }

  log.info('Student admission created', {
    studentId: createdStudent._id,
    admissionNumber: createdStudent.admissionNumber,
    user: req.user.email
  });

  await generateAdmissionDemand(createdStudent, academicYearId, payload.classRoom, req.user);

  // Auto-provision the student's central login account (username + temp password).
  let studentCredentials = null;
  try {
    const provisioned = await provisionStudentUser({ student: createdStudent, actor: req.user, req });
    if (provisioned && !provisioned.existing) {
      studentCredentials = { username: provisioned.username, temporaryPassword: provisioned.temporaryPassword };
    }
  } catch (error) {
    log.warn('Failed to provision student login account', { studentId: createdStudent._id, error: error.message });
  }

  // Parent linkage: reuse an explicitly selected parent account, otherwise
  // create/reuse a normalized Parent record + login from the primary guardian.
  let parentCredentials = null;
  try {
    if (payload.parentUserId) {
      await linkStudentToParentUser(payload.parentUserId, createdStudent._id);
      const parentUser = await User.findById(payload.parentUserId);
      if (parentUser?.parent && !createdStudent.parent) {
        createdStudent.parent = parentUser.parent;
        await createdStudent.save();
      }
    } else {
      const guardians = payload.guardians || [];
      const primaryGuardian = guardians.find((g) => g.isPrimary) || guardians[0];
      if (primaryGuardian) {
        const provisioned = await provisionParentForGuardian({ guardian: primaryGuardian, student: createdStudent, actor: req.user, req });
        parentCredentials = provisioned?.credentials || null;
      }
    }
  } catch (error) {
    log.warn('Failed to link parent for student', { studentId: createdStudent._id, error: error.message });
  }

  res.status(HTTP_STATUS.CREATED).json({
    ...createdStudent.toObject(),
    assignedClass: { name: classRoom.name, section: classRoom.section },
    assignedAcademicYear: activeYear?.name,
    monthlyFee: classRoom.monthlyFee,
    studentCredentials,
    parentCredentials
  });
});

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.classRoom) filter['enrollments.classRoom'] = req.query.classRoom;
  if (req.query.academicYear) filter['enrollments.academicYear'] = req.query.academicYear;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.section) {
    const classIds = await ClassRoom.find({ section: req.query.section }).distinct('_id');
    filter['enrollments.classRoom'] = filter['enrollments.classRoom']
      ? { $in: [filter['enrollments.classRoom'], ...classIds].filter(Boolean) }
      : { $in: classIds };
  }
  if (req.query.admissionFrom || req.query.admissionTo) {
    filter.admissionDate = {};
    if (req.query.admissionFrom) filter.admissionDate.$gte = new Date(req.query.admissionFrom);
    if (req.query.admissionTo) filter.admissionDate.$lte = new Date(req.query.admissionTo);
  }
  if (req.query.search) {
    const term = req.query.search.trim();
    const regex = new RegExp(term, 'i');
    filter.$or = [
      { admissionNumber: regex },
      { firstName: regex },
      { lastName: regex },
      { aadhaarNumber: term },
      { udisePenId: term },
      { 'guardians.name': regex },
      { 'guardians.phone': term },
      { 'enrollments.rollNumber': term }
    ];
  }
  if (req.user.role === ROLES.STUDENT) filter._id = req.user.student;
  if (req.user.role === ROLES.PARENT) {
    const childIds = req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : []);
    filter._id = { $in: childIds };
  }
  if (req.user.role === ROLES.TEACHER) {
    const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
    filter['enrollments.classRoom'] = { $in: classIds };
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, STUDENT_SORT_FIELDS);

  const [students, totalItems] = await Promise.all([
    Student.find(filter)
      .populate('enrollments.academicYear', 'name')
      .populate('enrollments.classRoom', 'name section')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    Student.countDocuments(filter)
  ]);

  return sendPaginated(
    res,
    students.map((student) => maskStudentRecord(student, req.user, req.permissions)),
    { page, pageSize, totalItems }
  );
});

// Search existing guardians (by name or phone) and parent login accounts for the admission form.
exports.searchParents = asyncHandler(async (req, res) => {
  const term = String(req.query.q || req.query.search || '').trim();
  if (term.length < 2) return res.json({ success: true, data: [] });

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');

  // Prefer the normalized Parent collection (single source of truth), then fall
  // back to legacy guardians (students not yet normalized) and standalone parent
  // User accounts. Results are merged so the same person appears only once.
  const [parents, students, accounts] = await Promise.all([
    Parent.find({ $or: [{ name: regex }, { phone: regex }, { email: regex }] })
      .populate('user', '_id')
      .limit(25),
    Student.find({ $or: [{ 'guardians.name': regex }, { 'guardians.phone': regex }] })
      .select('firstName lastName admissionNumber guardians parent')
      .limit(25),
    User.find({ role: ROLES.PARENT, $or: [{ name: regex }, { email: regex }] })
      .select('name email parent username')
      .limit(15)
  ]);

  const data = [];
  const byName = new Map();

  // Merge an entry into an existing same-name row when there is no conflicting
  // phone/email (treats "same name, complementary contact info" as one person),
  // otherwise add it as a distinct result.
  const addEntry = (entry) => {
    const nameKey = (entry.name || '').toLowerCase().trim();
    const existing = nameKey ? byName.get(nameKey) : null;
    if (existing) {
      const phoneConflict = existing.phone && entry.phone && existing.phone !== entry.phone;
      const emailConflict = existing.email && entry.email
        && existing.email.toLowerCase() !== entry.email.toLowerCase();
      if (!phoneConflict && !emailConflict) {
        if (!existing.phone && entry.phone) existing.phone = entry.phone;
        if (!existing.email && entry.email) existing.email = entry.email;
        if (!existing.relation && entry.relation) existing.relation = entry.relation;
        if (!existing.parentUserId && entry.parentUserId) existing.parentUserId = entry.parentUserId;
        if (!existing.admissionNumber && entry.admissionNumber) {
          existing.admissionNumber = entry.admissionNumber;
          existing.studentName = entry.studentName;
        }
        return;
      }
    }
    if (nameKey) byName.set(nameKey, entry);
    data.push(entry);
  };

  const normalizedParentIds = new Set();
  for (const parent of parents) {
    normalizedParentIds.add(String(parent._id));
    addEntry({
      name: parent.name || '',
      relation: parent.relation || '',
      phone: parent.phone || '',
      email: parent.email || '',
      parentUserId: parent.user?._id,
      parentId: parent._id,
      childrenCount: parent.children?.length || 0,
      source: 'parent'
    });
  }

  for (const student of students) {
    // Skip guardians already represented by a normalized Parent record.
    if (student.parent && normalizedParentIds.has(String(student.parent))) continue;
    for (const guardian of student.guardians || []) {
      if (!guardian?.name && !guardian?.phone) continue;
      if (!(regex.test(guardian.name || '') || regex.test(guardian.phone || ''))) continue;
      addEntry({
        name: guardian.name || '',
        relation: guardian.relation || '',
        phone: guardian.phone || '',
        email: guardian.email || '',
        studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
        admissionNumber: student.admissionNumber || '',
        source: 'guardian'
      });
    }
  }

  for (const account of accounts) {
    addEntry({
      name: account.name || '',
      email: account.email || '',
      parentUserId: account._id,
      parentId: account.parent,
      relation: '',
      phone: '',
      source: 'account'
    });
  }

  return res.json({ success: true, data: data.slice(0, 25) });
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
  res.json(maskStudentRecord(student, req.user, req.permissions));
});

exports.update = asyncHandler(async (req, res) => {
  if (req.user.role === 'student' || req.user.role === 'parent') {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ message: 'You do not have permission to edit student records' });
  }

  const existing = await Student.findById(req.params.id);
  if (!existing) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });
  assertOptimisticVersion(existing, req.body.__v);

  const mergedData = { ...existing.toObject(), ...req.body };
  const latestEnrollment = req.body.enrollments?.[0] || existing.enrollments?.filter((e) => e.status === 'studying').pop() || existing.enrollments?.at(-1);
  const classRoomId = latestEnrollment?.classRoom;
  const classRoom = classRoomId ? await ClassRoom.findById(classRoomId) : null;

  await validateAdmission({
    studentData: mergedData,
    guardians: req.body.guardians || existing.guardians,
    classRoom,
    academicYearId: latestEnrollment?.academicYear,
    rollNumber: latestEnrollment?.rollNumber,
    documents: existing.documents,
    excludeStudentId: existing._id,
    skipMandatoryDocs: true
  });

  const updateEntry = buildActivityEntry('profile_update', 'Student profile updated', req.user);
  const student = await Student.findByIdAndUpdate(
    req.params.id,
    { ...req.body, $push: { activityLog: updateEntry }, ...auditOnUpdate(req.user) },
    { new: true, runValidators: true }
  );

  logEntityUpdate({
    module: MODULES.STUDENTS,
    entityId: student._id,
    entityLabel: student.admissionNumber,
    action: ACTIONS.PROFILE_UPDATE,
    description: `Student profile updated: ${student.admissionNumber}`,
    user: req.user
  });

  log.info('Student updated', { studentId: student._id, user: req.user.email });
  invalidateNamespace('dashboard');
  invalidateNamespace('globalSearch');
  res.json(maskStudentRecord(student, req.user, req.permissions));
});

exports.updateStatus = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  const allowed = ['active', 'inactive', 'left_school', 'passed_out', 'tc_issued'];
  if (!allowed.includes(status)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: `Status must be one of: ${allowed.join(', ')}` });
  }

  const existing = await Student.findById(req.params.id);
  if (!existing) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const statusEntry = buildStatusChangeEntry(existing.status, status, req.user, reason, { entityType: 'student' });

  const student = await Student.findByIdAndUpdate(
    req.params.id,
    { status, $push: { activityLog: statusEntry }, ...auditOnUpdate(req.user) },
    { new: true, runValidators: true }
  );

  logStatusChange({
    module: MODULES.STUDENTS,
    entityId: student._id,
    entityLabel: student.admissionNumber,
    previousStatus: existing.status,
    newStatus: status,
    user: req.user,
    remarks: reason
  });

  log.info('Student status changed', { studentId: student._id, status, user: req.user.email });
  res.json(student);
});

exports.remove = asyncHandler(async (req, res) => {
  const existing = await Student.findById(req.params.id);
  if (!existing) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const statusEntry = buildStatusChangeEntry(existing.status, 'inactive', req.user, 'Student deactivated');
  const student = await Student.findByIdAndUpdate(
    req.params.id,
    { status: 'inactive', $push: { activityLog: statusEntry }, ...auditOnUpdate(req.user) },
    { new: true }
  );

  logStatusChange({
    module: MODULES.STUDENTS,
    entityId: student._id,
    entityLabel: student.admissionNumber,
    previousStatus: existing.status,
    newStatus: 'inactive',
    user: req.user,
    remarks: 'Student deactivated'
  });
  log.info('Student deactivated', { studentId: student._id, user: req.user.email });
  res.json({ deactivated: true, student });
});

exports.addDocument = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Document file is required' });
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const doc = await fileToDocument(req.file, req.body.type || 'other', req.body.title, 'students/documents');
  student.documents.push(doc);
  student.activityLog.push(buildActivityEntry('document_upload', `Document uploaded: ${doc.title}`, req.user, { type: doc.type }));
  await student.save();
  res.status(HTTP_STATUS.CREATED).json(student.documents.at(-1));
});

exports.replaceDocument = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Document file is required' });
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const doc = student.documents.id(req.params.documentId);
  if (!doc) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Document not found' });

  const stored = await uploadDocument(req.file, 'students/documents');
  doc.title = req.body.title || req.file.originalname;
  doc.fileUrl = stored.fileUrl;
  doc.storageKey = stored.storageKey;
  doc.storageProvider = stored.storageProvider;
  doc.mimeType = stored.mimeType;
  doc.size = stored.size;
  doc.uploadedAt = new Date();
  doc.status = 'uploaded';
  doc.rejectReason = '';

  student.activityLog.push(buildActivityEntry('document_replace', `Document replaced: ${doc.title}`, req.user, { documentId: doc._id }));
  await student.save();
  res.json(doc);
});

exports.deleteDocument = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const doc = student.documents.id(req.params.documentId);
  if (!doc) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Document not found' });

  const title = doc.title;
  doc.deleteOne();
  student.activityLog.push(buildActivityEntry('document_delete', `Document removed: ${title}`, req.user));
  await student.save();
  res.json({ deleted: true });
});

exports.promote = asyncHandler(async (req, res) => {
  const { promoteLegacy } = require('../services/promotion.service');
  const { studentIds, fromAcademicYear, toAcademicYear, toClassRoom, fromClassRoom } = req.body;
  if (!studentIds?.length || !fromAcademicYear || !toAcademicYear || !toClassRoom) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'studentIds, fromAcademicYear, toAcademicYear and toClassRoom are required' });
  }

  const result = await promoteLegacy(
    { studentIds, fromAcademicYear, toAcademicYear, toClassRoom, fromClassRoom },
    req.user
  );
  res.json(result);
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

async function ensureStudentDocumentAccess(req, student) {
  if (req.user.role === ROLES.STUDENT && req.user.student?.toString() !== req.params.id) {
    const error = new Error('Students can only access their own documents');
    error.status = HTTP_STATUS.FORBIDDEN;
    throw error;
  }
  if (req.user.role === ROLES.PARENT) {
    const childIds = (req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : [])).map(String);
    if (!childIds.includes(req.params.id)) {
      const error = new Error('Parents can only access their linked child documents');
      error.status = HTTP_STATUS.FORBIDDEN;
      throw error;
    }
  }
  if (req.user.role === ROLES.TEACHER) {
    const classIds = await ClassRoom.find({ classTeacher: req.user.teacher }).distinct('_id');
    const canAccess = student.enrollments.some((enrollment) =>
      classIds.some((id) => id.equals(enrollment.classRoom?._id || enrollment.classRoom))
    );
    if (!canAccess) {
      const error = new Error('Teacher can only access assigned class student documents');
      error.status = HTTP_STATUS.FORBIDDEN;
      throw error;
    }
  }
}

exports.getDocumentUrl = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  await ensureStudentDocumentAccess(req, student);

  const doc = student.documents.id(req.params.documentId);
  if (!doc) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Document not found' });

  const accessToken = issueAccessToken({
    userId: req.user._id || req.user.id,
    resourceType: 'student',
    resourceId: student._id,
    documentId: doc._id
  });
  const url = buildDocumentFileUrl(
    req,
    `/students/${req.params.id}/documents/${req.params.documentId}/file`,
    accessToken
  );
  res.json({
    url,
    fileName: doc.title,
    mimeType: doc.mimeType,
    expiresInSeconds: getAccessTtlSeconds()
  });
});

exports.streamDocument = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const entry = req.documentAccessEntry;
  const tokenValid = Boolean(
    entry
    && entry.resourceType === 'student'
    && entry.resourceId === String(student._id)
    && entry.documentId === String(req.params.documentId)
  ) || (
    req.query.accessToken
    && validateAccessToken(String(req.query.accessToken), {
      userId: req.user._id || req.user.id,
      resourceType: 'student',
      resourceId: student._id,
      documentId: req.params.documentId
    })
  );

  if (!tokenValid) {
    await ensureStudentDocumentAccess(req, student);
  }

  const doc = student.documents.id(req.params.documentId);
  if (!doc) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Document not found' });

  logDocumentAccess({
    module: MODULES.STUDENTS,
    entityId: student._id,
    entityLabel: student.admissionNumber,
    documentType: doc.type,
    user: req.user,
    req,
    meta: { documentId: doc._id, title: doc.title }
  });

  const key = extractStorageKey(doc.fileUrl, doc.storageKey);
  if (!key) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Document storage key not found' });
  }

  try {
    const { body, contentType } = await readDocument(key, doc.storageProvider);
    const fileName = (doc.title || 'document').replace(/[^\w.\-() ]/g, '_');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
    if (body.pipe) {
      body.pipe(res);
      return;
    }
    if (Buffer.isBuffer(body)) {
      return res.send(body);
    }
    const buffer = Buffer.from(await body.transformToByteArray());
    return res.send(buffer);
  } catch (error) {
    log.error('Document stream failed', {
      studentId: req.params.id,
      documentId: req.params.documentId,
      key,
      provider: doc.storageProvider,
      error: error.message,
      cause: error.cause?.message
    });
    const status = error.code === 'NotFound' ? HTTP_STATUS.NOT_FOUND : 502;
    return res.status(status).json({ message: error.message });
  }
});
