const Payroll = require('../models/Payroll');
const Teacher = require('../models/Teacher');
const { HTTP_STATUS } = require('../constants');
const { periodFromParts } = require('../utils/effectivePeriod');
const { integrityError, logIntegrityFailure } = require('./integrity.service');
const { assertOptimisticVersion } = require('../utils/optimisticLock');
const { softDeleteDocument } = require('./softDelete.service');
const { validateActiveTeacherReference } = require('./dataQuality.service');
const { getPolicySection } = require('./governanceConfig.service');

const PAYROLL_MODULE = 'payroll';

function resolveTeacherSalary(teacher, year, month) {
  const targetPeriod = periodFromParts(year, month);
  if (teacher.salaryHistory?.length) {
    const match = [...teacher.salaryHistory]
      .filter((entry) => {
        const from = new Date(entry.effectiveFrom);
        const fromPeriod = periodFromParts(from.getFullYear(), from.getMonth() + 1);
        const toPeriod = entry.effectiveTo
          ? periodFromParts(new Date(entry.effectiveTo).getFullYear(), new Date(entry.effectiveTo).getMonth() + 1)
          : Infinity;
        return targetPeriod >= fromPeriod && targetPeriod <= toPeriod;
      })
      .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0];
    if (match) return match.basicSalary;
  }
  return teacher.baseSalary;
}

async function applySalaryRevision(teacher, newSalary, effectiveFrom, user) {
  const salary = Math.max(Number(newSalary) || 0, 0);
  const effectiveDate = effectiveFrom ? new Date(effectiveFrom) : new Date();

  teacher.salaryHistory = teacher.salaryHistory || [];
  const openEntry = teacher.salaryHistory.find((entry) => !entry.effectiveTo);
  if (openEntry && openEntry.basicSalary === salary) {
    teacher.baseSalary = salary;
    return teacher;
  }

  if (openEntry) {
    const closeDate = new Date(effectiveDate);
    closeDate.setDate(closeDate.getDate() - 1);
    openEntry.effectiveTo = closeDate;
  }

  teacher.salaryHistory.push({
    basicSalary: salary,
    effectiveFrom: effectiveDate,
    recordedAt: new Date(),
    recordedBy: user?.id || user?._id
  });
  teacher.baseSalary = salary;
  if (user?.id || user?._id) teacher.updatedBy = user.id || user._id;
  await teacher.save();
  return teacher;
}

async function ensureNoDuplicatePayroll(teacherId, month, year, excludeId) {
  const existing = await Payroll.findOne({
    teacher: teacherId,
    month,
    year,
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  });
  if (existing) {
    throw integrityError(
      `Payroll record already exists for this teacher in ${month}/${year}`,
      'DUPLICATE_PAYROLL',
      { teacherId, month, year, existingId: existing._id }
    );
  }
}

function assertPayrollEditable(payroll, audit) {
  if (payroll.locked || payroll.status === 'paid') {
    if (audit) {
      logIntegrityFailure({
        module: PAYROLL_MODULE,
        entityId: payroll._id,
        entityLabel: `${payroll.month}/${payroll.year}`,
        rule: 'LOCKED_PAYROLL',
        message: 'Locked payroll records cannot be edited',
        user: audit.user,
        details: { status: payroll.status, locked: payroll.locked }
      });
    }
    throw integrityError('Locked payroll records cannot be edited', 'LOCKED_RECORD');
  }
}

async function validateTeacherForPayroll(teacherId) {
  const teacher = await Teacher.findById(teacherId);
  if (!teacher || teacher.isDeleted) {
    const error = new Error('Teacher not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }
  if (teacher.status !== 'active') {
    throw integrityError('Payroll can only be created for active teachers', 'INACTIVE_TEACHER');
  }
  await validateActiveTeacherReference(teacher._id, {
    module: PAYROLL_MODULE,
    entityId: teacher._id,
    entityLabel: teacher.employeeCode
  });
  return teacher;
}

async function createPayroll(payload, user) {
  const month = Number(payload.month);
  const year = Number(payload.year);
  const teacher = await validateTeacherForPayroll(payload.teacher);

  await ensureNoDuplicatePayroll(teacher._id, month, year);

  const basicSalary = payload.basicSalary != null
    ? Math.max(Number(payload.basicSalary) || 0, 0)
    : resolveTeacherSalary(teacher, year, month);

  const payroll = await Payroll.create({
    teacher: teacher._id,
    month,
    year,
    basicSalary,
    allowances: Math.max(Number(payload.allowances) || 0, 0),
    deductions: Math.max(Number(payload.deductions) || 0, 0),
    paymentMode: payload.paymentMode || 'bank_transfer',
    status: 'pending',
    remarks: payload.remarks,
    salaryEffectiveSnapshot: resolveTeacherSalary(teacher, year, month),
    createdBy: user?.id,
    updatedBy: user?.id
  });

  return payroll.populate('teacher', 'firstName lastName employeeCode baseSalary');
}

async function updatePayroll(payrollId, payload, user, audit) {
  const payroll = await Payroll.findById(payrollId);
  if (!payroll) {
    const error = new Error('Payroll record not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }

  assertPayrollEditable(payroll, audit);
  assertOptimisticVersion(payroll, payload.__v);

  if (payload.basicSalary !== undefined) payroll.basicSalary = Math.max(Number(payload.basicSalary) || 0, 0);
  if (payload.allowances !== undefined) payroll.allowances = Math.max(Number(payload.allowances) || 0, 0);
  if (payload.deductions !== undefined) payroll.deductions = Math.max(Number(payload.deductions) || 0, 0);
  if (payload.paymentMode !== undefined) payroll.paymentMode = payload.paymentMode;
  if (payload.remarks !== undefined) payroll.remarks = payload.remarks;
  payroll.updatedBy = user?.id;
  await payroll.save();

  return payroll.populate('teacher', 'firstName lastName employeeCode baseSalary');
}

async function markPayrollPaid(payrollId, payload, user, audit) {
  const payroll = await Payroll.findById(payrollId);
  if (!payroll) {
    const error = new Error('Payroll record not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }

  if (payroll.status === 'paid' && payroll.locked) {
    throw integrityError('Payroll is already paid and locked', 'LOCKED_RECORD');
  }

  const policies = await getPolicySection('payrollPolicies');
  payroll.status = 'paid';
  payroll.paidAt = payload.paidAt ? new Date(payload.paidAt) : new Date();
  payroll.paymentMode = payload.paymentMode || payroll.paymentMode;
  if (payload.remarks !== undefined) payroll.remarks = payload.remarks;
  if (policies.lockOnMarkPaid !== false) {
    payroll.locked = true;
    payroll.lockedAt = new Date();
    payroll.lockedBy = user?.id;
  }
  payroll.updatedBy = user?.id;
  await payroll.save();

  return payroll.populate('teacher', 'firstName lastName employeeCode baseSalary');
}

async function removePayroll(payrollId, user, audit) {
  const payroll = await Payroll.findById(payrollId);
  if (!payroll) {
    const error = new Error('Payroll record not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }

  assertPayrollEditable(payroll, audit);
  const policies = await getPolicySection('payrollPolicies');
  if (policies.allowDeletePendingOnly !== false && payroll.status !== 'pending') {
    throw integrityError('Only pending payroll records can be deleted', 'LOCKED_RECORD');
  }
  await softDeleteDocument(payroll, user);
  return { deleted: true, softDeleted: true };
}

async function unlockPayroll(payrollId, user) {
  const payroll = await Payroll.findById(payrollId);
  if (!payroll) {
    const error = new Error('Payroll record not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }
  if (!payroll.locked && payroll.status !== 'paid') {
    throw integrityError('Payroll record is not locked', 'NOT_LOCKED');
  }

  payroll.locked = false;
  payroll.status = 'pending';
  payroll.paidAt = undefined;
  payroll.unlockedAt = new Date();
  payroll.unlockedBy = user?.id;
  payroll.updatedBy = user?.id;
  await payroll.save();

  return payroll.populate('teacher', 'firstName lastName employeeCode baseSalary');
}

module.exports = {
  PAYROLL_MODULE,
  resolveTeacherSalary,
  applySalaryRevision,
  ensureNoDuplicatePayroll,
  assertPayrollEditable,
  createPayroll,
  updatePayroll,
  markPayrollPaid,
  removePayroll,
  unlockPayroll
};
