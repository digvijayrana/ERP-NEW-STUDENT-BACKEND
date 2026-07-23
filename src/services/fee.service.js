const AcademicYear = require('../models/AcademicYear');
const ClassRoom = require('../models/ClassRoom');
const FeeInvoice = require('../models/FeeInvoice');
const FeeStructure = require('../models/FeeStructure');
const Student = require('../models/Student');
const { nextInvoiceNumber, nextReceiptNumber } = require('./sequence.service');
const { resolveBusFee } = require('./bus.service');
const { ensureAcademicYearEditable, assertLockedReceiptEditable } = require('./integrity.service');
const { HTTP_STATUS } = require('../constants');
const { withTransaction } = require('../utils/withTransaction');
const { invalidateNamespace } = require('./cache.service');
const { getPolicySection } = require('./governanceConfig.service');
function demandPeriod(year, month) {
  return { feeYear: year, feeMonth: month };
}

function monthEndDueDate(year, month) {
  return new Date(year, month, 0);
}

function getActiveEnrollment(student, academicYearId) {
  return student.enrollments?.find(
    (enrollment) =>
      enrollment.academicYear?.toString() === academicYearId.toString() &&
      enrollment.status === 'studying'
  );
}

async function resolveTuitionFee(student, academicYearId, classRoomId) {
  const enrollment = getActiveEnrollment(student, academicYearId);
  if (enrollment?.monthlyFee != null) return enrollment.monthlyFee;

  const classRoom = await ClassRoom.findById(classRoomId).select('monthlyFee');
  return classRoom?.monthlyFee || 0;
}

/**
 * Resolve the active fee structure that applies to a section. Fee structures are
 * defined per class NAME (shared across sections). Resolution order:
 *   1. the structure explicitly linked on the classroom,
 *   2. the class-level structure matched by (academicYear, className),
 *   3. a legacy per-section structure matched by (academicYear, classRoom).
 */
async function resolveActiveFeeStructure(academicYearId, classRoomId) {
  const classRoom = await ClassRoom.findById(classRoomId).select('name feeStructure').lean();

  if (classRoom?.feeStructure) {
    const linked = await FeeStructure.findOne({ _id: classRoom.feeStructure, status: 'active' }).lean();
    if (linked) return linked;
  }

  if (classRoom?.name) {
    const byName = await FeeStructure.findOne({
      academicYear: academicYearId,
      className: String(classRoom.name).trim(),
      status: 'active'
    }).lean();
    if (byName) return byName;
  }

  return FeeStructure.findOne({ academicYear: academicYearId, classRoom: classRoomId, status: 'active' }).lean();
}

async function calculatePreviousPending(studentId, academicYearId, year, month) {
  const priorInvoices = await FeeInvoice.find({
    student: studentId,
    academicYear: academicYearId,
    status: { $nin: ['cancelled'] },
    $or: [{ feeYear: { $lt: year } }, { feeYear: year, feeMonth: { $lt: month } }]
  }).lean({ virtuals: true });

  return priorInvoices.reduce((sum, invoice) => sum + Math.max(invoice.balanceAmount || 0, 0), 0);
}

// Number of months covered by a billing cycle / a component frequency.
const CYCLE_MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

function cycleMonths(cycle) {
  return CYCLE_MONTHS[cycle] || 1;
}

// Amount a recurring component contributes when a demand is generated for `monthsInCycle`
// months. A component's amount is expressed per its own frequency, so we normalise to a
// monthly rate and multiply by the requested cycle length.
// e.g. a quarterly ₹3000 component == ₹1000/month -> a quarterly demand bills ₹3000,
// a monthly demand bills ₹1000, a yearly demand bills ₹12000.
function proratedAmount(amount, frequency, monthsInCycle) {
  const perMonth = amount / cycleMonths(frequency);
  return Math.round(perMonth * monthsInCycle);
}

// Due date = last day of the final month covered by the cycle.
function cycleEndDueDate(year, month, monthsInCycle) {
  return new Date(year, month - 1 + monthsInCycle, 0);
}

async function buildDemandData(student, academicYearId, classRoomId, year, month, cycle = 'monthly') {
  const monthsInCycle = cycleMonths(cycle);
  const previousPending = await calculatePreviousPending(student._id, academicYearId, year, month);

  const [hasYearInvoice, hasAnyInvoice, structure] = await Promise.all([
    FeeInvoice.exists({ student: student._id, academicYear: academicYearId, status: { $ne: 'cancelled' } }),
    FeeInvoice.exists({ student: student._id, status: { $ne: 'cancelled' } }),
    resolveActiveFeeStructure(academicYearId, classRoomId)
  ]);
  const isFirstDemandOfYear = !hasYearInvoice;
  const isNewStudent = !hasAnyInvoice;

  let structureTuition = 0;
  let structureHasTuition = false;
  let structureBusFee = 0;
  let otherCharges = 0;
  const feeComponents = [];

  if (structure && Array.isArray(structure.components)) {
    for (const component of structure.components) {
      const amount = Math.max(Number(component.amount) || 0, 0);
      if (amount <= 0) continue;

      let billed;
      if (component.frequency === 'one_time') {
        // One-time items bill once: admission for brand-new students, others on the year's first demand.
        const due = component.newAdmissionOnly ? isNewStudent : isFirstDemandOfYear;
        if (!due) continue;
        billed = amount;
      } else {
        billed = proratedAmount(amount, component.frequency, monthsInCycle);
        if (billed <= 0) continue;
      }

      if (component.key === 'tuition') {
        structureHasTuition = true;
        structureTuition += billed;
        continue;
      }
      if (component.key === 'bus') {
        structureBusFee += billed;
        continue;
      }
      otherCharges += billed;
      feeComponents.push({ key: component.key, label: component.label, amount: billed });
    }
  }

  // Tuition precedence: structure (when it defines tuition) > per-student enrollment override > class default.
  let tuitionFee = 0;
  if (structureHasTuition) {
    tuitionFee = structureTuition;
  } else {
    const enrollment = getActiveEnrollment(student, academicYearId);
    let baseMonthly;
    if (enrollment?.monthlyFee != null) {
      baseMonthly = enrollment.monthlyFee;
    } else {
      const classRoom = await ClassRoom.findById(classRoomId).select('monthlyFee');
      baseMonthly = classRoom?.monthlyFee || 0;
    }
    tuitionFee = baseMonthly * monthsInCycle;
  }
  if (tuitionFee > 0) feeComponents.unshift({ key: 'tuition', label: 'Tuition Fee', amount: tuitionFee });

  // Bus fee: an actual bus registration always wins over a structure default (avoids double billing).
  const registrationBus = resolveBusFee(student, year, month);
  const busFee = registrationBus > 0 ? registrationBus * monthsInCycle : structureBusFee;
  if (busFee > 0) feeComponents.push({ key: 'bus', label: 'Bus Fee', amount: busFee });

  return {
    tuitionFee,
    busFee,
    otherCharges,
    previousPending,
    discount: 0,
    fine: 0,
    feeComponents,
    ...demandPeriod(year, month),
    billingCycle: cycle,
    dueDate: cycleEndDueDate(year, month, monthsInCycle),
    items: [
      ...feeComponents.map((component) => ({ label: component.label, amount: component.amount })),
      ...(previousPending > 0 ? [{ label: 'Previous Pending', amount: previousPending }] : [])
    ].filter((item) => item.amount > 0)
  };
}

async function ensureNoDuplicateDemand(studentId, academicYearId, year, month) {
  const existing = await FeeInvoice.findOne({
    student: studentId,
    academicYear: academicYearId,
    feeYear: year,
    feeMonth: month,
    status: { $ne: 'cancelled' }
  });
  if (existing) {
    const error = new Error(`Fee demand already exists for ${month}/${year}`);
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'DUPLICATE_DEMAND';
    throw error;
  }
}

async function createDemandForStudent(student, academicYearId, classRoomId, year, month, cycle = 'monthly') {
  await ensureAcademicYearEditable(academicYearId);
  await ensureNoDuplicateDemand(student._id, academicYearId, year, month);
  const demand = await buildDemandData(student, academicYearId, classRoomId, year, month, cycle);

  return FeeInvoice.create({
    student: student._id,
    academicYear: academicYearId,
    classRoom: classRoomId,
    invoiceNumber: await nextInvoiceNumber(),
    ...demand
  });
}

async function generateMonthlyDemands({ academicYearId, year, month, classRoomId, studentId, cycle = 'monthly' }) {
  const yearDoc = academicYearId
    ? await AcademicYear.findById(academicYearId)
    : await AcademicYear.findOne({ status: 'active' });

  if (!yearDoc) {
    const error = new Error('No active academic year found for fee demand generation');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  await ensureAcademicYearEditable(yearDoc._id);

  const targetYear = year || new Date().getFullYear();
  const targetMonth = month || new Date().getMonth() + 1;

  const studentFilter = {
    status: 'active',
    enrollments: {
      $elemMatch: {
        academicYear: yearDoc._id,
        status: 'studying',
        ...(classRoomId ? { classRoom: classRoomId } : {})
      }
    }
  };
  if (studentId) studentFilter._id = studentId;

  const students = await Student.find(studentFilter);
  const created = [];
  const skipped = [];

  for (const student of students) {
    const enrollment = getActiveEnrollment(student, yearDoc._id);
    if (!enrollment) continue;

    try {
      const invoice = await createDemandForStudent(
        student,
        yearDoc._id,
        enrollment.classRoom,
        targetYear,
        targetMonth,
        cycle
      );
      created.push(invoice);
    } catch (error) {
      if (error.code === 'DUPLICATE_DEMAND') {
        skipped.push({ student: student._id, reason: error.message });
      } else {
        throw error;
      }
    }
  }

  return {
    academicYear: yearDoc._id,
    feeMonth: targetMonth,
    feeYear: targetYear,
    cycle,
    created: created.length,
    skipped: skipped.length,
    invoices: created
  };
}

async function autoGenerateCurrentMonthDemands() {
  try {
    const result = await generateMonthlyDemands({});
    if (result.created > 0) {
      return { ok: true, ...result };
    }
    return { ok: true, created: 0, skipped: result.skipped, message: 'No new demands generated' };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function updateDemandAdjustments(invoice, { discount, fine, otherCharges }) {
  if (invoice.locked) {
    const error = new Error('Locked fee demand cannot be modified');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'LOCKED_RECORD';
    throw error;
  }
  if (discount !== undefined) invoice.discount = Math.max(Number(discount) || 0, 0);
  if (fine !== undefined) invoice.fine = Math.max(Number(fine) || 0, 0);
  if (otherCharges !== undefined) invoice.otherCharges = Math.max(Number(otherCharges) || 0, 0);
  await invoice.save();
  return invoice;
}

async function collectPayment(invoice, paymentData, user) {
  if (invoice.status === 'cancelled') {
    const error = new Error('Cannot collect payment on a cancelled demand');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  if (invoice.locked && invoice.balanceAmount <= 0) {
    const error = new Error('This fee demand is fully paid and locked');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  const amount = Number(paymentData.amount);
  if (!amount || amount <= 0) {
    const error = new Error('Payment amount must be greater than zero');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  if (amount > invoice.balanceAmount) {
    const error = new Error(`Payment exceeds balance due (${invoice.balanceAmount})`);
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  const receiptNumber = await nextReceiptNumber();
  const feePolicies = await getPolicySection('feePolicies');
  const lockReceipt = feePolicies.lockReceiptOnPayment !== false;
  invoice.payments.push({
    receiptNumber,
    amount,
    mode: paymentData.mode || 'cash',
    referenceNumber: paymentData.referenceNumber,
    remarks: paymentData.remarks,
    paidAt: paymentData.paidAt || new Date(),
    status: 'active',
    locked: lockReceipt,
    discountApplied: invoice.discount || 0,
    fineApplied: invoice.fine || 0
  });

  if (user) {
    invoice.updatedBy = user._id || user.id;
  }

  return withTransaction(async (session) => {
    await invoice.save({ session });

    const student = await Student.findById(invoice.student).session(session);
    const payment = invoice.payments[invoice.payments.length - 1];
    if (student) {
      student.activityLog = student.activityLog || [];
      student.activityLog.push({
        action: 'fee_payment',
        description: `Fee payment received: ${payment.receiptNumber} — ₹${payment.amount}`,
        performedBy: user?.email || user?.id || 'accounts',
        performedAt: payment.paidAt || new Date(),
        meta: {
          receiptNumber: payment.receiptNumber,
          amount: payment.amount,
          invoiceNumber: invoice.invoiceNumber,
          mode: payment.mode
        }
      });
      await student.save({ session });
    }

    return { invoice, payment };
  }).then((result) => {
    invalidateNamespace('dashboard');
    return result;
  });
}

async function voidPayment(invoice, paymentId, reason, user) {
  const payment = invoice.payments.id(paymentId);
  if (!payment) {
    const error = new Error('Payment receipt not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }
  if (payment.status === 'void') {
    const error = new Error('Receipt is already void');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
  assertLockedReceiptEditable(payment, {
    module: 'fees',
    entityId: invoice._id,
    user
  });

  payment.status = 'void';
  payment.remarks = reason ? `VOID: ${reason}` : payment.remarks;
  invoice.locked = false;
  if (user) invoice.updatedBy = user._id || user.id;
  await invoice.save();
  return { invoice, payment };
}

async function unlockPayment(invoice, paymentId) {
  const payment = invoice.payments.id(paymentId);
  if (!payment) {
    const error = new Error('Payment receipt not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }
  payment.locked = false;
  invoice.locked = false;
  await invoice.save();
  return { invoice, payment };
}

async function listFeeHistoryPaginated({ filter = {}, search, paymentStatus, skip = 0, limit = 10 } = {}) {
  const match = { ...filter };
  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'students',
        localField: 'student',
        foreignField: '_id',
        as: 'studentDoc'
      }
    },
    { $unwind: { path: '$studentDoc', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'classrooms',
        localField: 'classRoom',
        foreignField: '_id',
        as: 'classDoc'
      }
    },
    { $unwind: { path: '$classDoc', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'academicyears',
        localField: 'academicYear',
        foreignField: '_id',
        as: 'yearDoc'
      }
    },
    { $unwind: { path: '$yearDoc', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        invoiceId: '$_id',
        invoiceNumber: 1,
        feeMonth: 1,
        feeYear: 1,
        tuitionFee: 1,
        busFee: 1,
        payments: { $ifNull: ['$payments', []] },
        student: {
          _id: '$studentDoc._id',
          firstName: '$studentDoc.firstName',
          lastName: '$studentDoc.lastName',
          admissionNumber: '$studentDoc.admissionNumber'
        },
        classRoom: { _id: '$classDoc._id', name: '$classDoc.name', section: '$classDoc.section' },
        academicYear: { _id: '$yearDoc._id', name: '$yearDoc.name' },
        balanceAmount: {
          $max: [
            {
              $subtract: [
                {
                  $add: [
                    { $ifNull: ['$tuitionFee', 0] },
                    { $ifNull: ['$busFee', 0] },
                    { $ifNull: ['$otherCharges', 0] },
                    { $ifNull: ['$previousPending', 0] },
                    { $ifNull: ['$fine', 0] }
                  ]
                },
                { $ifNull: ['$discount', 0] }
              ]
            },
            0
          ]
        },
        status: 1,
        locked: 1,
        createdAt: 1
      }
    },
    { $unwind: { path: '$payments', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        invoiceId: 1,
        paymentId: '$payments._id',
        invoiceNumber: 1,
        receiptNumber: '$payments.receiptNumber',
        student: 1,
        academicYear: 1,
        classRoom: 1,
        feeMonth: 1,
        feeYear: 1,
        tuitionFee: 1,
        busFee: 1,
        paidAmount: { $ifNull: ['$payments.amount', 0] },
        pendingAmount: '$balanceAmount',
        paymentDate: '$payments.paidAt',
        createdAt: 1,
        paymentStatus: {
          $cond: [
            { $eq: ['$payments.status', 'void'] },
            'void',
            '$status'
          ]
        },
        mode: '$payments.mode',
        locked: { $ifNull: ['$payments.locked', '$locked'] }
      }
    }
  ];

  if (paymentStatus) {
    pipeline.push({ $match: { paymentStatus } });
  }
  if (search) {
    const term = search.trim();
    pipeline.push({
      $match: {
        $or: [
          { receiptNumber: new RegExp(term, 'i') },
          { invoiceNumber: new RegExp(term, 'i') },
          { 'student.firstName': new RegExp(term, 'i') },
          { 'student.lastName': new RegExp(term, 'i') },
          { 'student.admissionNumber': new RegExp(term, 'i') }
        ]
      }
    });
  }

  pipeline.push({
    $facet: {
      rows: [
        { $sort: { paymentDate: -1, feeYear: -1, feeMonth: -1 } },
        { $skip: skip },
        { $limit: limit }
      ],
      total: [{ $count: 'count' }]
    }
  });

  const [result] = await FeeInvoice.aggregate(pipeline);
  return {
    rows: result?.rows || [],
    totalItems: result?.total?.[0]?.count || 0
  };
}

async function listFeeHistory(filter = {}) {
  const invoices = await FeeInvoice.find(filter)
    .populate('student', 'firstName lastName admissionNumber')
    .populate('classRoom', 'name section')
    .populate('academicYear', 'name')
    .sort({ feeYear: -1, feeMonth: -1 })
    .lean({ virtuals: true });

  const history = [];
  for (const invoice of invoices) {
    for (const payment of invoice.payments || []) {
      history.push({
        invoiceId: invoice._id,
        paymentId: payment._id,
        invoiceNumber: invoice.invoiceNumber,
        receiptNumber: payment.receiptNumber,
        student: invoice.student,
        academicYear: invoice.academicYear,
        classRoom: invoice.classRoom,
        feeMonth: invoice.feeMonth,
        feeYear: invoice.feeYear,
        tuitionFee: invoice.tuitionFee,
        busFee: invoice.busFee,
        paidAmount: payment.amount,
        pendingAmount: invoice.balanceAmount,
        paymentDate: payment.paidAt,
        createdAt: invoice.createdAt,
        paymentStatus: payment.status === 'void' ? 'void' : invoice.status,
        mode: payment.mode,
        locked: payment.locked
      });
    }
    if (!invoice.payments?.length) {
      history.push({
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        receiptNumber: null,
        student: invoice.student,
        academicYear: invoice.academicYear,
        classRoom: invoice.classRoom,
        feeMonth: invoice.feeMonth,
        feeYear: invoice.feeYear,
        tuitionFee: invoice.tuitionFee,
        busFee: invoice.busFee,
        paidAmount: 0,
        pendingAmount: invoice.balanceAmount,
        paymentDate: null,
        createdAt: invoice.createdAt,
        paymentStatus: invoice.status,
        mode: null,
        locked: invoice.locked
      });
    }
  }

  return history.sort((a, b) => new Date(b.paymentDate || 0) - new Date(a.paymentDate || 0));
}

module.exports = {
  demandPeriod,
  resolveTuitionFee,
  resolveBusFee,
  buildDemandData,
  createDemandForStudent,
  generateMonthlyDemands,
  autoGenerateCurrentMonthDemands,
  updateDemandAdjustments,
  collectPayment,
  voidPayment,
  unlockPayment,
  listFeeHistory,
  listFeeHistoryPaginated,
  ensureNoDuplicateDemand
};
