const mongoose = require('mongoose');
const Student = require('../models/Student');
const ClassRoom = require('../models/ClassRoom');
const AcademicYear = require('../models/AcademicYear');
const FeeInvoice = require('../models/FeeInvoice');
const PromotionBatch = require('../models/PromotionBatch');
const { HTTP_STATUS } = require('../constants');
const { buildActivityEntry } = require('./activityLog.service');
const { logEntityUpdate } = require('./activityLog.service');
const { integrityError } = require('./integrity.service');
const { withTransaction } = require('../utils/withTransaction');
const { getPolicySection } = require('./governanceConfig.service');
const { validatePromotionEligibility } = require('./dataQuality.service');

const PROMOTION_MODULE = 'promotion';

function serviceError(message, status = HTTP_STATUS.BAD_REQUEST, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function classLabel(room) {
  if (!room) return '—';
  return `${room.name || ''}-${room.section || ''}`.replace(/^-|-$/g, '') || '—';
}

function studentLabel(student) {
  return [student?.firstName, student?.lastName].filter(Boolean).join(' ');
}

function getStudyingEnrollment(student, academicYearId, classRoomId) {
  return (student.enrollments || []).find(
    (entry) =>
      String(entry.academicYear) === String(academicYearId) &&
      entry.status === 'studying' &&
      (!classRoomId || String(entry.classRoom) === String(classRoomId))
  );
}

function hasTargetEnrollment(student, toAcademicYearId) {
  return (student.enrollments || []).some(
    (entry) => String(entry.academicYear) === String(toAcademicYearId) && entry.status === 'studying'
  );
}

async function buildWarnings(student, fromAcademicYearId) {
  const warnings = [];
  if (!student.aadhaarNumber) {
    warnings.push({ code: 'MISSING_AADHAAR', message: 'Aadhaar number is missing' });
  }
  if (!student.udisePenId) {
    warnings.push({ code: 'MISSING_UDISE', message: 'UDISE+/PEN ID is missing' });
  }

  const docs = student.documents || [];
  const hasPhoto = docs.some((doc) => doc.type === 'photo');
  const hasBirth = docs.some((doc) => doc.type === 'birth_certificate');
  if (!hasPhoto || !hasBirth) {
    warnings.push({ code: 'MISSING_DOCUMENTS', message: 'Mandatory documents are missing' });
  }

  const pendingCount = await FeeInvoice.countDocuments({
    student: student._id,
    academicYear: fromAcademicYearId,
    status: { $in: ['unpaid', 'partial'] }
  });
  if (pendingCount > 0) {
    warnings.push({ code: 'PENDING_FEES', message: `Pending fee balance exists (${pendingCount} invoice(s))` });
  }

  return warnings;
}

function evaluateEligibility(student, fromAcademicYearId, fromClassRoomId, toAcademicYearId) {
  if (student.status !== 'active') {
    return { eligible: false, reason: 'Student status is not active' };
  }
  const enrollment = getStudyingEnrollment(student, fromAcademicYearId, fromClassRoomId);
  if (!enrollment) {
    return { eligible: false, reason: 'Student is not enrolled in the selected class and academic year' };
  }
  if (hasTargetEnrollment(student, toAcademicYearId)) {
    return { eligible: false, reason: 'Student is already enrolled in the target academic year' };
  }
  return { eligible: true, enrollment };
}

function busAssignmentLabel(student) {
  const bus = student.busAssignment;
  if (!bus?.active || !bus.busService) return 'No active bus service';
  return `${bus.routeName || 'Route'} — ${bus.stopName || bus.pickupPoint || 'Stop'}`;
}

async function loadContext({ fromAcademicYear, toAcademicYear, fromClassRoom, toClassRoom }) {
  const [fromYear, toYear, fromClass, toClass] = await Promise.all([
    AcademicYear.findById(fromAcademicYear),
    AcademicYear.findById(toAcademicYear),
    ClassRoom.findById(fromClassRoom),
    ClassRoom.findById(toClassRoom)
  ]);

  if (!fromYear || !toYear) throw serviceError('Academic year not found', HTTP_STATUS.NOT_FOUND);
  if (!fromClass || !toClass) throw serviceError('Class not found', HTTP_STATUS.NOT_FOUND);
  if (fromClass.status === 'inactive' || toClass.status === 'inactive') {
    throw serviceError('Inactive classes cannot be used for promotion');
  }

  return { fromYear, toYear, fromClass, toClass };
}

async function listEligibleStudents({ fromAcademicYear, fromClassRoom, toAcademicYear }) {
  await loadContext({ fromAcademicYear, toAcademicYear, fromClassRoom, toClassRoom: fromClassRoom });

  const students = await Student.find({
    status: 'active',
    enrollments: {
      $elemMatch: {
        academicYear: fromAcademicYear,
        classRoom: fromClassRoom,
        status: 'studying'
      }
    }
  }).sort({ admissionNumber: 1 });

  const rows = [];
  for (const student of students) {
    const eligibility = evaluateEligibility(student, fromAcademicYear, fromClassRoom, toAcademicYear);
    const warnings = eligibility.eligible ? await buildWarnings(student, fromAcademicYear) : [];
    rows.push({
      studentId: student._id,
      admissionNumber: student.admissionNumber,
      studentName: studentLabel(student),
      eligible: eligibility.eligible,
      ineligibleReason: eligibility.reason,
      warnings,
      currentRollNumber: eligibility.enrollment?.rollNumber || '',
      currentClass: classLabel(await ClassRoom.findById(fromClassRoom))
    });
  }

  return rows;
}

async function collectUsedRollNumbers(academicYearId, classRoomId, extraRolls = []) {
  const used = new Set(extraRolls.map((roll) => String(roll).trim()).filter(Boolean));
  const students = await Student.find({
    enrollments: {
      $elemMatch: {
        academicYear: academicYearId,
        classRoom: classRoomId,
        status: 'studying'
      }
    }
  }).select('enrollments');

  for (const student of students) {
    const enrollment = getStudyingEnrollment(student, academicYearId, classRoomId);
    if (enrollment?.rollNumber) used.add(String(enrollment.rollNumber).trim());
  }
  return used;
}

async function nextAutoRoll(academicYearId, classRoomId, assigned = []) {
  const used = await collectUsedRollNumbers(academicYearId, classRoomId, assigned);
  let candidate = 1;
  while (used.has(String(candidate))) candidate += 1;
  return String(candidate);
}

async function assertRollUnique(rollNumber, academicYearId, classRoomId, excludeStudentId, assignedRolls = []) {
  const roll = String(rollNumber || '').trim();
  if (!roll) throw serviceError('Roll number is required');

  if (assignedRolls.filter((item) => String(item).trim() === roll).length > 1) {
    throw serviceError(`Duplicate roll number ${roll} in the promotion batch`);
  }

  const duplicate = await Student.findOne({
    ...(excludeStudentId ? { _id: { $ne: excludeStudentId } } : {}),
    enrollments: {
      $elemMatch: {
        academicYear: academicYearId,
        classRoom: classRoomId,
        rollNumber: roll,
        status: 'studying'
      }
    }
  }).select('admissionNumber');

  if (duplicate) {
    throw serviceError(`Roll number ${roll} is already assigned in the target class`);
  }
}

async function buildPreview(payload) {
  const {
    fromAcademicYear,
    toAcademicYear,
    fromClassRoom,
    toClassRoom,
    studentIds = [],
    excludedStudentIds = [],
    rollMode = 'auto',
    rollAssignments = {}
  } = payload;

  const { fromYear, toYear, fromClass, toClass } = await loadContext({
    fromAcademicYear,
    toAcademicYear,
    fromClassRoom,
    toClassRoom
  });

  const excluded = new Set((excludedStudentIds || []).map(String));
  const selected = new Set((studentIds || []).map(String));
  const queryIds = selected.size
    ? { _id: { $in: [...selected] } }
    : {
        status: 'active',
        enrollments: {
          $elemMatch: {
            academicYear: fromAcademicYear,
            classRoom: fromClassRoom,
            status: 'studying'
          }
        }
      };

  const students = await Student.find(queryIds).sort({ admissionNumber: 1 });
  const promotionRules = await getPolicySection('promotionRules');
  const previewRows = [];
  const assignedRolls = [];

  for (const student of students) {
    const included = !excluded.has(String(student._id));
    const eligibility = evaluateEligibility(student, fromAcademicYear, fromClassRoom, toAcademicYear);
    const warnings = eligibility.eligible ? await buildWarnings(student, fromAcademicYear) : [];
    let eligible = eligibility.eligible;
    let ineligibleReason = eligibility.reason;
    if (eligible && promotionRules.requireFeesClear && warnings.some((warning) => warning.code === 'PENDING_FEES')) {
      eligible = false;
      ineligibleReason = 'Pending fees must be cleared before promotion';
    }
    if (eligible && promotionRules.blockOnUnresolvedWarnings && warnings.length) {
      eligible = false;
      ineligibleReason = 'Unresolved promotion warnings must be cleared';
    }
    const currentEnrollment = eligibility.enrollment;

    let proposedRoll = '';
    if (included && eligible) {
      if (rollMode === 'manual') {
        proposedRoll = String(rollAssignments[student._id] || rollAssignments[String(student._id)] || '').trim();
        if (!proposedRoll) throw serviceError(`Roll number is required for ${student.admissionNumber}`);
        await assertRollUnique(proposedRoll, toAcademicYear, toClassRoom, student._id, assignedRolls);
      } else {
        proposedRoll = await nextAutoRoll(toAcademicYear, toClassRoom, assignedRolls);
      }
      assignedRolls.push(proposedRoll);
    }

    previewRows.push({
      studentId: student._id,
      admissionNumber: student.admissionNumber,
      studentName: studentLabel(student),
      included,
      eligible,
      ineligibleReason,
      warnings,
      current: {
        academicYear: fromYear.name,
        classSection: classLabel(fromClass),
        rollNumber: currentEnrollment?.rollNumber || '—',
        monthlyFee: currentEnrollment?.monthlyFee ?? fromClass.monthlyFee ?? 0,
        busAssignment: busAssignmentLabel(student)
      },
      proposed: included && eligible
        ? {
            academicYear: toYear.name,
            classSection: classLabel(toClass),
            rollNumber: proposedRoll,
            monthlyFee: toClass.monthlyFee ?? 0,
            busAssignment: busAssignmentLabel(student)
          }
        : null
    });
  }

  return {
    fromAcademicYear,
    toAcademicYear,
    fromClassRoom,
    toClassRoom,
    rollMode,
    rows: previewRows,
    promotableCount: previewRows.filter((row) => row.included && row.eligible).length,
    warningCount: previewRows.reduce((sum, row) => sum + row.warnings.length, 0)
  };
}

async function applyStudentPromotion(student, context, entry, user, session) {
  const enrollment = getStudyingEnrollment(
    student,
    context.fromAcademicYear,
    context.fromClassRoom
  );
  if (!enrollment) throw serviceError(`Cannot promote ${student.admissionNumber}`);

  enrollment.status = 'promoted';
  enrollment.toDate = new Date();

  const newEnrollment = {
    academicYear: context.toAcademicYear,
    classRoom: context.toClassRoom,
    rollNumber: entry.rollNumber,
    monthlyFee: context.toClass.monthlyFee ?? 0,
    status: 'studying',
    fromDate: new Date()
  };

  student.enrollments.push(newEnrollment);
  const newEnrollmentDoc = student.enrollments[student.enrollments.length - 1];

  student.activityLog = student.activityLog || [];
  student.activityLog.push(
    buildActivityEntry(
      'promotion',
      `Promoted to ${classLabel(context.toClass)} (${context.toYear.name})`,
      user,
      {
        fromAcademicYear: context.fromAcademicYear,
        toAcademicYear: context.toAcademicYear,
        fromClassRoom: context.fromClassRoom,
        toClassRoom: context.toClassRoom,
        rollNumber: entry.rollNumber
      }
    )
  );

  await student.save(session ? { session } : undefined);

  return {
    previousEnrollmentId: enrollment._id,
    previousStatus: 'studying',
    previousToDate: enrollment.toDate,
    newEnrollmentId: newEnrollmentDoc._id
  };
}

async function revertStudentPromotion(student, rollback) {
  const studentDoc = await Student.findById(student);
  if (!studentDoc || !rollback?.newEnrollmentId) return;

  const newEnrollment = studentDoc.enrollments.id(rollback.newEnrollmentId);
  if (newEnrollment) newEnrollment.deleteOne();

  const previous = studentDoc.enrollments.id(rollback.previousEnrollmentId);
  if (previous) {
    previous.status = rollback.previousStatus || 'studying';
    previous.toDate = rollback.previousToDate || undefined;
  }

  studentDoc.activityLog = studentDoc.activityLog || [];
  studentDoc.activityLog.push(
    buildActivityEntry('promotion_rollback', 'Promotion rolled back to previous enrollment', null, {
      previousEnrollmentId: rollback.previousEnrollmentId
    })
  );

  await studentDoc.save();
}

async function executePromotion(payload, user) {
  const preview = await buildPreview(payload);
  const promotable = preview.rows.filter((row) => row.included && row.eligible);
  if (!promotable.length) throw serviceError('No eligible students selected for promotion');

  const context = await loadContext({
    fromAcademicYear: payload.fromAcademicYear,
    toAcademicYear: payload.toAcademicYear,
    fromClassRoom: payload.fromClassRoom,
    toClassRoom: payload.toClassRoom
  });

  return withTransaction(async (session) => {
    const [batch] = await PromotionBatch.create([{
      fromAcademicYear: payload.fromAcademicYear,
      toAcademicYear: payload.toAcademicYear,
      fromClassRoom: payload.fromClassRoom,
      toClassRoom: payload.toClassRoom,
      rollMode: payload.rollMode || 'auto',
      status: 'draft',
      locked: false,
      warningsAcknowledged: !!payload.warningsAcknowledged,
      createdBy: user?.id,
      updatedBy: user?.id,
      students: []
    }], { session });

    let promotedCount = 0;
    let excludedCount = 0;

    for (const row of preview.rows) {
      const student = await Student.findById(row.studentId).session(session);
      if (!student) continue;

      const batchEntry = {
        student: student._id,
        included: row.included,
        outcome: row.included && row.eligible ? 'promoted' : row.included ? 'detained' : 'excluded',
        rollNumber: row.proposed?.rollNumber,
        eligible: row.eligible,
        ineligibleReason: row.ineligibleReason,
        warnings: row.warnings,
        current: {
          academicYear: payload.fromAcademicYear,
          classRoom: payload.fromClassRoom,
          rollNumber: row.current.rollNumber,
          monthlyFee: row.current.monthlyFee,
          classLabel: row.current.classSection,
          yearLabel: row.current.academicYear
        },
        proposed: row.proposed
          ? {
              academicYear: payload.toAcademicYear,
              classRoom: payload.toClassRoom,
              rollNumber: row.proposed.rollNumber,
              monthlyFee: row.proposed.monthlyFee,
              classLabel: row.proposed.classSection,
              yearLabel: row.proposed.academicYear
            }
          : undefined,
        busAssignmentLabel: row.current.busAssignment
      };

      if (row.included && row.eligible) {
        await validatePromotionEligibility(student, row.warnings);
        const rollback = await applyStudentPromotion(
          student,
          {
            fromAcademicYear: payload.fromAcademicYear,
            toAcademicYear: payload.toAcademicYear,
            fromClassRoom: payload.fromClassRoom,
            toClassRoom: payload.toClassRoom,
            fromYear: context.fromYear,
            toYear: context.toYear,
            fromClass: context.fromClass,
            toClass: context.toClass
          },
          { rollNumber: row.proposed.rollNumber },
          user,
          session
        );
        batchEntry.rollback = rollback;
        promotedCount += 1;
      } else if (row.included) {
        excludedCount += 1;
      } else {
        excludedCount += 1;
      }

      batch.students.push(batchEntry);
    }

    batch.promotedCount = promotedCount;
    batch.excludedCount = excludedCount;
    await batch.save({ session });

    logEntityUpdate({
      module: PROMOTION_MODULE,
      entityId: batch._id,
      entityLabel: `batch-${batch._id}`,
      action: 'promotion_execute',
      description: `Promotion executed for ${promotedCount} student(s)`,
      user,
      meta: { promotedCount, excludedCount, status: 'draft' }
    });

    return populateBatch(batch._id);
  });
}

async function rollbackBatch(batchId, user) {
  const batch = await PromotionBatch.findById(batchId);
  if (!batch) throw serviceError('Promotion batch not found', HTTP_STATUS.NOT_FOUND);
  if (batch.locked || batch.status === 'finalized') {
    throw integrityError('Finalized promotions cannot be rolled back', 'LOCKED_RECORD');
  }
  if (batch.status === 'rolled_back') {
    throw serviceError('Promotion batch has already been rolled back');
  }

  for (const entry of batch.students) {
    if (entry.rollback?.newEnrollmentId) {
      await revertStudentPromotion(entry.student, entry.rollback);
    }
  }

  batch.status = 'rolled_back';
  batch.rolledBackAt = new Date();
  batch.rolledBackBy = user?.id;
  batch.updatedBy = user?.id;
  await batch.save();

  logEntityUpdate({
    module: PROMOTION_MODULE,
    entityId: batch._id,
    entityLabel: `batch-${batch._id}`,
    action: 'promotion_rollback',
    description: `Promotion batch rolled back (${batch.promotedCount} student(s))`,
    user
  });

  return populateBatch(batch._id);
}

async function finalizeBatch(batchId, user) {
  const batch = await PromotionBatch.findById(batchId);
  if (!batch) throw serviceError('Promotion batch not found', HTTP_STATUS.NOT_FOUND);
  if (batch.status === 'rolled_back') throw serviceError('Rolled back promotions cannot be finalized');
  if (batch.locked || batch.status === 'finalized') throw serviceError('Promotion batch is already finalized');

  batch.status = 'finalized';
  batch.locked = true;
  batch.finalizedAt = new Date();
  batch.finalizedBy = user?.id;
  batch.updatedBy = user?.id;
  await batch.save();

  logEntityUpdate({
    module: PROMOTION_MODULE,
    entityId: batch._id,
    entityLabel: `batch-${batch._id}`,
    action: 'promotion_finalize',
    description: `Promotion batch finalized and locked (${batch.promotedCount} student(s))`,
    user
  });

  return populateBatch(batch._id);
}

async function populateBatch(id) {
  return PromotionBatch.findById(id)
    .populate('fromAcademicYear', 'name')
    .populate('toAcademicYear', 'name')
    .populate('fromClassRoom', 'name section')
    .populate('toClassRoom', 'name section')
    .populate('students.student', 'admissionNumber firstName lastName');
}

async function getBatch(batchId) {
  const batch = await populateBatch(batchId);
  if (!batch) throw serviceError('Promotion batch not found', HTTP_STATUS.NOT_FOUND);
  return batch;
}

async function buildPromotionReport(reportType, filters = {}) {
  const fromYear = filters.fromAcademicYear;
  const toYear = filters.toAcademicYear;
  const classRoom = filters.classRoom;

  if (reportType === 'promoted') {
    const match = { status: 'finalized' };
    if (fromYear) match.fromAcademicYear = fromYear;
    if (toYear) match.toAcademicYear = toYear;
    const batches = await PromotionBatch.find(match).populate('students.student', 'admissionNumber firstName lastName');
    return batches.flatMap((batch) =>
      batch.students
        .filter((entry) => entry.outcome === 'promoted')
        .map((entry) => ({
          admissionNumber: entry.student?.admissionNumber,
          studentName: studentLabel(entry.student),
          fromYear: batch.fromAcademicYear?.name,
          toYear: batch.toAcademicYear?.name,
          fromClass: entry.current?.classLabel,
          toClass: entry.proposed?.classLabel,
          rollNumber: entry.proposed?.rollNumber,
          monthlyFee: entry.proposed?.monthlyFee,
          batchId: batch._id,
          finalizedAt: batch.finalizedAt
        }))
    );
  }

  if (reportType === 'detained') {
    const query = {
      status: 'active',
      enrollments: {
        $elemMatch: {
          academicYear: fromYear || { $exists: true },
          status: 'studying',
          ...(classRoom ? { classRoom } : {})
        }
      }
    };
    if (toYear) {
      const promotedIds = await PromotionBatch.distinct('students.student', {
        toAcademicYear: toYear,
        status: 'finalized',
        'students.outcome': 'promoted'
      });
      if (promotedIds.length) query._id = { $nin: promotedIds };
    }

    const students = await Student.find(query).sort({ admissionNumber: 1 });
    const classMap = await loadClassMap(students, fromYear);
    return students.map((student) => {
      const enrollment = getStudyingEnrollment(student, fromYear, classRoom);
      const room = enrollment?.classRoom ? classMap[String(enrollment.classRoom)] : null;
      return {
        admissionNumber: student.admissionNumber,
        studentName: studentLabel(student),
        classSection: classLabel(room),
        rollNumber: enrollment?.rollNumber || '—',
        status: 'detained'
      };
    });
  }

  if (reportType === 'left-school') {
    return loadStatusReport('left_school', filters);
  }

  if (reportType === 'tc-issued') {
    return loadStatusReport('tc_issued', filters);
  }

  if (reportType === 'class-strength-comparison') {
    const fromRows = await strengthByClass(fromYear);
    const toRows = await strengthByClass(toYear);
    const keys = new Set([...Object.keys(fromRows), ...Object.keys(toRows)]);
    return [...keys].map((key) => ({
      classSection: key,
      fromYearCount: fromRows[key] || 0,
      toYearCount: toRows[key] || 0,
      difference: (toRows[key] || 0) - (fromRows[key] || 0)
    }));
  }

  throw serviceError('Unknown promotion report type');
}

async function loadClassMap(students, academicYearId) {
  const classIds = [];
  for (const student of students) {
    const enrollment = getStudyingEnrollment(student, academicYearId);
    if (enrollment?.classRoom) classIds.push(enrollment.classRoom);
  }
  const rooms = await ClassRoom.find({ _id: { $in: [...new Set(classIds.map(String))] } }).lean();
  return Object.fromEntries(rooms.map((room) => [String(room._id), room]));
}

async function strengthByClass(academicYearId) {
  if (!academicYearId) return {};
  const students = await Student.find({
    status: 'active',
    enrollments: {
      $elemMatch: { academicYear: academicYearId, status: 'studying' }
    }
  });
  const classMap = await loadClassMap(students, academicYearId);
  const grouped = {};
  for (const student of students) {
    const enrollment = getStudyingEnrollment(student, academicYearId);
    const room = enrollment?.classRoom ? classMap[String(enrollment.classRoom)] : null;
    const key = classLabel(room);
    grouped[key] = (grouped[key] || 0) + 1;
  }
  return grouped;
}

async function loadStatusReport(status, filters = {}) {
  const query = { status };
  const students = await Student.find(query).sort({ admissionNumber: 1 });
  return students.map((student) => ({
    admissionNumber: student.admissionNumber,
    studentName: studentLabel(student),
    status,
    admissionDate: student.admissionDate
  }));
}

async function promoteLegacy(payload, user) {
  let fromClassRoom = payload.fromClassRoom;
  if (!fromClassRoom && payload.studentIds?.length) {
    const student = await Student.findById(payload.studentIds[0]);
    const enrollment = getStudyingEnrollment(student, payload.fromAcademicYear);
    fromClassRoom = enrollment?.classRoom;
  }
  if (!fromClassRoom) throw serviceError('fromClassRoom is required for promotion');

  const result = await executePromotion(
    {
      ...payload,
      fromClassRoom,
      rollMode: 'auto',
      warningsAcknowledged: true
    },
    user
  );
  const finalized = await finalizeBatch(result._id, user);
  return { promoted: finalized.promotedCount, batchId: finalized._id };
}

module.exports = {
  PROMOTION_MODULE,
  listEligibleStudents,
  buildPreview,
  executePromotion,
  rollbackBatch,
  finalizeBatch,
  getBatch,
  buildPromotionReport,
  promoteLegacy,
  nextAutoRoll,
  assertRollUnique
};
