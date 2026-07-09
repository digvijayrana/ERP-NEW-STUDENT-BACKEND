const mongoose = require('mongoose');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const ClassRoom = require('../models/ClassRoom');
const AcademicYear = require('../models/AcademicYear');
const FeeInvoice = require('../models/FeeInvoice');
const BusRegistration = require('../models/BusRegistration');
const Payroll = require('../models/Payroll');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { integrityError, logIntegrityFailure } = require('./integrity.service');
const { getPolicySection } = require('./governanceConfig.service');
const { recordActivity } = require('./activityLog.service');
const { MODULES, ACTIONS } = require('../constants/activityActions');
const { MANDATORY_DOC_TYPES } = require('../config/workflow.config');

function missingMandatoryDocsFilter(types = MANDATORY_DOC_TYPES) {
  return {
    $or: types.map((type) => ({
      documents: { $not: { $elemMatch: { type, fileUrl: { $exists: true, $nin: [null, ''] } } } }
    }))
  };
}

async function findOrphanStudents(limit = 50) {
  const students = await Student.find({ status: 'active', isDeleted: { $ne: true } })
    .select('admissionNumber firstName lastName enrollments')
    .limit(500)
    .lean();

  const classIds = [...new Set(students.flatMap((s) => (s.enrollments || []).map((e) => String(e.classRoom))))];
  const yearIds = [...new Set(students.flatMap((s) => (s.enrollments || []).map((e) => String(e.academicYear))))];
  const [classes, years] = await Promise.all([
    ClassRoom.find({ _id: { $in: classIds } }).select('_id status isDeleted').lean(),
    AcademicYear.find({ _id: { $in: yearIds } }).select('_id status isDeleted').lean()
  ]);
  const classMap = new Map(classes.map((entry) => [String(entry._id), entry]));
  const yearMap = new Map(years.map((entry) => [String(entry._id), entry]));

  const orphans = [];
  for (const student of students) {
    for (const enrollment of student.enrollments || []) {
      if (enrollment.status !== 'studying') continue;
      const classRoom = classMap.get(String(enrollment.classRoom));
      const year = yearMap.get(String(enrollment.academicYear));
      if (!classRoom || classRoom.isDeleted || !year || year.isDeleted || year.status === 'closed') {
        orphans.push({
          type: 'orphan_enrollment',
          studentId: student._id,
          admissionNumber: student.admissionNumber,
          studentName: [student.firstName, student.lastName].filter(Boolean).join(' '),
          classRoomId: enrollment.classRoom,
          academicYearId: enrollment.academicYear,
          reason: !classRoom ? 'missing_class' : classRoom.isDeleted ? 'deleted_class' : !year ? 'missing_year' : 'closed_or_deleted_year'
        });
        if (orphans.length >= limit) return orphans;
      }
    }
  }
  return orphans;
}

async function findBrokenReferences(limit = 50) {
  const issues = [];

  const invoices = await FeeInvoice.find({ status: { $ne: 'cancelled' }, isDeleted: { $ne: true } })
    .select('invoiceNumber student classRoom academicYear')
    .limit(200)
    .lean();
  const studentIds = [...new Set(invoices.map((entry) => String(entry.student)))];
  const classIds = [...new Set(invoices.map((entry) => String(entry.classRoom)))];
  const [students, classes] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select('_id status isDeleted').lean(),
    ClassRoom.find({ _id: { $in: classIds } }).select('_id status isDeleted').lean()
  ]);
  const studentMap = new Map(students.map((entry) => [String(entry._id), entry]));
  const classMap = new Map(classes.map((entry) => [String(entry._id), entry]));

  for (const invoice of invoices) {
    const student = studentMap.get(String(invoice.student));
    const classRoom = classMap.get(String(invoice.classRoom));
    if (!student || student.isDeleted || student.status !== 'active' || !classRoom || classRoom.isDeleted) {
      issues.push({
        type: 'broken_fee_reference',
        entity: 'fee_invoice',
        id: invoice._id,
        label: invoice.invoiceNumber,
        reason: !student ? 'missing_student' : student.isDeleted ? 'deleted_student' : !classRoom ? 'missing_class' : 'inactive_mapping'
      });
      if (issues.length >= limit) return issues;
    }
  }

  const registrations = await BusRegistration.find({ status: 'active', isDeleted: { $ne: true } })
    .select('student route academicYear')
    .limit(200)
    .lean();
  const regStudentIds = [...new Set(registrations.map((entry) => String(entry.student)))];
  const regStudents = await Student.find({ _id: { $in: regStudentIds } }).select('_id status isDeleted').lean();
  const regStudentMap = new Map(regStudents.map((entry) => [String(entry._id), entry]));
  for (const registration of registrations) {
    const student = regStudentMap.get(String(registration.student));
    if (!student || student.isDeleted || student.status !== 'active') {
      issues.push({
        type: 'broken_bus_reference',
        entity: 'bus_registration',
        id: registration._id,
        studentId: registration.student,
        reason: 'inactive_or_missing_student'
      });
      if (issues.length >= limit) return issues;
    }
  }

  return issues;
}

async function findInactiveMappings(limit = 50) {
  const issues = [];
  const classes = await ClassRoom.find({
    status: 'active',
    isDeleted: { $ne: true },
    classTeacher: { $exists: true, $ne: null }
  })
    .select('name section classTeacher')
    .lean();
  const teacherIds = [...new Set(classes.map((entry) => String(entry.classTeacher)))];
  const teachers = await Teacher.find({ _id: { $in: teacherIds } }).select('_id status isDeleted employeeCode').lean();
  const teacherMap = new Map(teachers.map((entry) => [String(entry._id), entry]));

  for (const classRoom of classes) {
    const teacher = teacherMap.get(String(classRoom.classTeacher));
    if (!teacher || teacher.isDeleted || teacher.status !== 'active') {
      issues.push({
        type: 'inactive_teacher_mapping',
        entity: 'class_room',
        id: classRoom._id,
        label: `${classRoom.name}-${classRoom.section}`,
        teacherId: classRoom.classTeacher,
        reason: 'inactive_or_missing_teacher'
      });
      if (issues.length >= limit) return issues;
    }
  }
  return issues;
}

async function findDuplicateWarnings() {
  const [teacherCodeGroups, classGroups] = await Promise.all([
    Teacher.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: '$employeeCode', count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 10 }
    ]),
    ClassRoom.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: { name: '$name', section: '$section', academicYear: '$academicYear' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 10 }
    ])
  ]);

  return {
    duplicateTeacherCodes: teacherCodeGroups.map((entry) => ({
      employeeCode: entry._id,
      count: entry.count,
      ids: entry.ids
    })),
    duplicateClasses: classGroups.map((entry) => ({
      name: entry._id.name,
      section: entry._id.section,
      academicYear: entry._id.academicYear,
      count: entry.count,
      ids: entry.ids
    }))
  };
}

async function buildDataQualityReport() {
  const [orphans, brokenRefs, inactiveMappings, duplicates] = await Promise.all([
    findOrphanStudents(),
    findBrokenReferences(),
    findInactiveMappings(),
    findDuplicateWarnings()
  ]);

  const warnings = [
    ...orphans.map((entry) => ({ severity: 'warning', category: 'orphan_record', ...entry })),
    ...brokenRefs.map((entry) => ({ severity: 'danger', category: 'broken_reference', ...entry })),
    ...inactiveMappings.map((entry) => ({ severity: 'warning', category: 'inactive_mapping', ...entry }))
  ];

  return {
    summary: {
      orphanRecords: orphans.length,
      brokenReferences: brokenRefs.length,
      inactiveMappings: inactiveMappings.length,
      duplicateTeacherCodes: duplicates.duplicateTeacherCodes.length,
      duplicateClasses: duplicates.duplicateClasses.length,
      totalWarnings: warnings.length
    },
    warnings: warnings.slice(0, 100),
    duplicates
  };
}

async function validateInactiveClassAssignment(classRoomId) {
  const promotionRules = await getPolicySection('promotionRules');
  if (!promotionRules.blockInactiveClassPromotion) return;

  const classRoom = await ClassRoom.findById(classRoomId).select('status isDeleted name section');
  if (!classRoom || classRoom.isDeleted || classRoom.status !== 'active') {
    throw integrityError('Cannot assign students to an inactive or deleted class', 'INACTIVE_MAPPING');
  }
}

async function validateActiveTeacherReference(teacherId, audit) {
  const payrollPolicies = await getPolicySection('payrollPolicies');
  if (!payrollPolicies.requireActiveTeacher || !teacherId) return;

  const teacher = await Teacher.findById(teacherId).select('status isDeleted employeeCode');
  if (!teacher || teacher.isDeleted || teacher.status !== 'active') {
    if (audit) {
      logIntegrityFailure({
        module: audit.module || MODULES.TEACHERS,
        entityId: teacherId,
        entityLabel: teacher?.employeeCode,
        rule: 'INACTIVE_TEACHER_REFERENCE',
        message: 'Referenced teacher is inactive or deleted',
        user: audit.user
      });
    }
    throw integrityError('Referenced teacher is inactive or deleted', 'INACTIVE_MAPPING');
  }
}

async function validateObjectIdReference(Model, id, label, audit) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw integrityError(`${label} reference is invalid`, 'BROKEN_REFERENCE');
  }
  const record = await Model.findById(id).select('_id isDeleted status');
  if (!record || record.isDeleted) {
    if (audit) {
      logIntegrityFailure({
        module: audit.module,
        entityId: id,
        entityLabel: label,
        rule: 'BROKEN_REFERENCE',
        message: `${label} reference does not exist`,
        user: audit.user
      });
    }
    throw integrityError(`${label} reference does not exist or was deleted`, 'BROKEN_REFERENCE');
  }
  return record;
}

async function validatePromotionEligibility(student, warnings = []) {
  const rules = await getPolicySection('promotionRules');
  if (rules.blockOnUnresolvedWarnings && warnings.length) {
    throw integrityError('Promotion blocked due to unresolved warnings', 'INVALID_PROMOTION', { warnings });
  }
  if (rules.requireMandatoryDocuments) {
    const missingDocs = MANDATORY_DOC_TYPES.some((type) =>
      !(student.documents || []).some((doc) => doc.type === type && doc.fileUrl)
    );
    if (missingDocs) {
      throw integrityError('Promotion blocked: mandatory documents are missing', 'INVALID_PROMOTION');
    }
  }
  if (rules.requireAadhaar && !student.aadhaarNumber) {
    throw integrityError('Promotion blocked: Aadhaar number is required', 'INVALID_PROMOTION');
  }
}

function logDataQualityWarning(message, meta, user) {
  recordActivity({
    module: MODULES.GOVERNANCE,
    entityLabel: 'data_quality',
    action: ACTIONS.DATA_QUALITY_WARNING,
    description: message,
    user,
    meta
  });
}

module.exports = {
  missingMandatoryDocsFilter,
  findOrphanStudents,
  findBrokenReferences,
  findInactiveMappings,
  findDuplicateWarnings,
  buildDataQualityReport,
  validateInactiveClassAssignment,
  validateActiveTeacherReference,
  validateObjectIdReference,
  validatePromotionEligibility,
  logDataQualityWarning
};
