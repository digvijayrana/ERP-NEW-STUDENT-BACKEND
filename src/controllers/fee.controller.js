const FeeInvoice = require('../models/FeeInvoice');
const Student = require('../models/Student');
const asyncHandler = require('../middleware/asyncHandler');
const { feeInvoicePdf, feeReceiptPdf } = require('../services/pdf.service');
const {
  generateMonthlyDemands,
  createDemandForStudent,
  updateDemandAdjustments,
  collectPayment,
  voidPayment,
  unlockPayment,
  listFeeHistory,
  listFeeHistoryPaginated,
  buildDemandData
} = require('../services/fee.service');
const { nextInvoiceNumber } = require('../services/sequence.service');
const { logEntityCreate, logEntityUpdate } = require('../services/activityLog.service');
const { assertReversalAllowed, logReversal, logUnlock } = require('../services/businessRules.service');
const { HTTP_STATUS, ROLES, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');

const INVOICE_SORT_FIELDS = ['invoiceNumber', 'dueDate', 'feeYear', 'feeMonth', 'status', 'createdAt'];

const FEE_MODULE = 'fees';

function logFeeActivity({ action, description, user, entityId, entityLabel, meta }) {
  logEntityUpdate({
    module: FEE_MODULE,
    entityId,
    entityLabel,
    action,
    description,
    user,
    meta
  });
}

async function populateInvoice(id) {
  return FeeInvoice.findById(id)
    .populate('student', 'firstName lastName admissionNumber')
    .populate('classRoom', 'name section monthlyFee')
    .populate('academicYear', 'name');
}

function assertInvoiceAccess(req, invoice) {
  if (req.user.role === ROLES.STUDENT && invoice.student._id?.toString() !== req.user.student?.toString()) {
    const error = new Error('Students can access only their own fee records');
    error.status = HTTP_STATUS.FORBIDDEN;
    throw error;
  }
  if (req.user.role === ROLES.PARENT) {
    const childIds = (req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : [])).map(String);
    if (!childIds.includes(invoice.student._id.toString())) {
      const error = new Error('Parents can access only their linked child fee records');
      error.status = HTTP_STATUS.FORBIDDEN;
      throw error;
    }
  }
}

exports.generateDemands = asyncHandler(async (req, res) => {
  const { academicYear, classRoom, year, month } = req.body;
  const result = await generateMonthlyDemands({ academicYearId: academicYear, classRoomId: classRoom, year, month });

  logFeeActivity({
    action: 'fee_demand_generation',
    description: `Generated ${result.created} fee demands for ${result.feeMonth}/${result.feeYear}`,
    user: req.user,
    entityLabel: `demands-${result.feeYear}-${result.feeMonth}`,
    meta: { created: result.created, skipped: result.skipped }
  });

  res.status(HTTP_STATUS.CREATED).json(result);
});

exports.createInvoice = asyncHandler(async (req, res) => {
  const { student, academicYear, classRoom, year, month, discount, fine, otherCharges } = req.body;
  const studentDoc = await Student.findById(student);
  if (!studentDoc) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const targetYear = year || new Date(req.body.dueDate || Date.now()).getFullYear();
  const targetMonth = month || new Date(req.body.dueDate || Date.now()).getMonth() + 1;

  const invoice = await createDemandForStudent(studentDoc, academicYear, classRoom, targetYear, targetMonth);
  if (discount || fine || otherCharges) {
    await updateDemandAdjustments(invoice, { discount, fine, otherCharges });
  }

  logFeeActivity({
    action: 'fee_demand_create',
    description: `Fee demand created: ${invoice.invoiceNumber}`,
    user: req.user,
    entityId: invoice._id,
    entityLabel: invoice.invoiceNumber
  });

  res.status(HTTP_STATUS.CREATED).json(await populateInvoice(invoice._id));
});

exports.createBulkMonthlyInvoices = asyncHandler(async (req, res) => {
  const result = await generateMonthlyDemands({
    academicYearId: req.body.academicYear,
    classRoomId: req.body.classRoom,
    year: req.body.year,
    month: req.body.month
  });
  res.status(HTTP_STATUS.CREATED).json({ created: result.created, skipped: result.skipped });
});

exports.listInvoices = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.student) filter.student = req.query.student;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.academicYear) filter.academicYear = req.query.academicYear;
  if (req.query.classRoom) filter.classRoom = req.query.classRoom;
  if (req.query.feeMonth) filter.feeMonth = Number(req.query.feeMonth);
  if (req.query.feeYear) filter.feeYear = Number(req.query.feeYear);

  if (req.user.role === ROLES.STUDENT) filter.student = req.user.student;
  if (req.user.role === ROLES.PARENT) {
    const childIds = req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : []);
    const selectedChild = req.query.student && childIds.map(String).includes(String(req.query.student)) ? req.query.student : null;
    filter.student = selectedChild || { $in: childIds };
  }

  if (req.query.search) {
    const term = req.query.search.trim();
    const regex = new RegExp(term, 'i');
    const students = await Student.find({
      $or: [{ admissionNumber: regex }, { firstName: regex }, { lastName: regex }]
    }).distinct('_id');
    filter.$or = [{ invoiceNumber: regex }, { student: { $in: students } }];
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, INVOICE_SORT_FIELDS, 'dueDate');

  const [invoices, totalItems] = await Promise.all([
    FeeInvoice.find(filter)
      .populate('student', 'firstName lastName admissionNumber')
      .populate('classRoom', 'name section')
      .populate('academicYear', 'name')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    FeeInvoice.countDocuments(filter)
  ]);

  return sendPaginated(res, invoices, { page, pageSize, totalItems });
});

exports.getInvoice = asyncHandler(async (req, res) => {
  const invoice = await populateInvoice(req.params.id);
  if (!invoice) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Invoice not found' });
  assertInvoiceAccess(req, invoice);
  res.json(invoice);
});

exports.previewDemand = asyncHandler(async (req, res) => {
  const { student, academicYear, classRoom, year, month } = req.query;
  const studentDoc = await Student.findById(student);
  if (!studentDoc) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const targetYear = Number(year) || new Date().getFullYear();
  const targetMonth = Number(month) || new Date().getMonth() + 1;
  const demand = await buildDemandData(studentDoc, academicYear, classRoom, targetYear, targetMonth);
  const totalPayable = demand.tuitionFee + demand.busFee + demand.otherCharges + demand.previousPending;

  res.json({
    ...demand,
    totalPayable,
    feeMonth: targetMonth,
    feeYear: targetYear
  });
});

exports.updateInvoice = asyncHandler(async (req, res) => {
  const invoice = await FeeInvoice.findById(req.params.id);
  if (!invoice) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Invoice not found' });

  await updateDemandAdjustments(invoice, {
    discount: req.body.discount,
    fine: req.body.fine,
    otherCharges: req.body.otherCharges
  });

  logFeeActivity({
    action: 'fee_demand_update',
    description: `Fee demand updated: ${invoice.invoiceNumber}`,
    user: req.user,
    entityId: invoice._id,
    entityLabel: invoice.invoiceNumber
  });

  res.json(await populateInvoice(invoice._id));
});

exports.addPayment = asyncHandler(async (req, res) => {
  const invoice = await FeeInvoice.findById(req.params.id);
  if (!invoice) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Invoice not found' });

  if (req.body.discount !== undefined || req.body.fine !== undefined || req.body.otherCharges !== undefined) {
    await updateDemandAdjustments(invoice, {
      discount: req.body.discount,
      fine: req.body.fine,
      otherCharges: req.body.otherCharges
    });
  }

  const { invoice: updated, payment } = await collectPayment(invoice, req.body, req.user);

  logFeeActivity({
    action: 'fee_collection',
    description: `Payment collected: ${payment.receiptNumber} (${payment.amount})`,
    user: req.user,
    entityId: updated._id,
    entityLabel: payment.receiptNumber,
    meta: { invoiceNumber: updated.invoiceNumber, amount: payment.amount, mode: payment.mode }
  });

  res.status(HTTP_STATUS.CREATED).json(await populateInvoice(updated._id));
});

exports.voidPayment = asyncHandler(async (req, res) => {
  assertReversalAllowed('fee_void', req.user, req.permissions);
  const invoice = await FeeInvoice.findById(req.params.id);
  if (!invoice) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Invoice not found' });

  const payment = invoice.payments.id(req.params.paymentId);
  const previousStatus = payment?.status;
  const { invoice: updated, payment: voidedPayment } = await voidPayment(invoice, req.params.paymentId, req.body.reason, req.user);

  logReversal({
    module: FEE_MODULE,
    entityId: updated._id,
    entityLabel: voidedPayment.receiptNumber,
    reversalType: 'fee_void',
    user: req.user,
    req,
    previousValue: { status: previousStatus },
    updatedValue: { status: 'void' },
    remarks: req.body.reason
  });

  logFeeActivity({
    action: 'receipt_void',
    description: `Receipt voided: ${voidedPayment.receiptNumber}`,
    user: req.user,
    entityId: updated._id,
    entityLabel: voidedPayment.receiptNumber,
    meta: { reason: req.body.reason }
  });

  res.json(await populateInvoice(updated._id));
});

exports.unlockPayment = asyncHandler(async (req, res) => {
  assertReversalAllowed('fee_unlock', req.user, req.permissions);
  const invoice = await FeeInvoice.findById(req.params.id);
  if (!invoice) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Invoice not found' });

  const payment = invoice.payments.id(req.params.paymentId);
  const { invoice: updated, payment: unlockedPayment } = await unlockPayment(invoice, req.params.paymentId);

  logUnlock({
    module: FEE_MODULE,
    entityId: updated._id,
    entityLabel: unlockedPayment.receiptNumber,
    user: req.user,
    req,
    previousValue: { locked: true },
    updatedValue: { locked: false }
  });

  logFeeActivity({
    action: 'receipt_unlock',
    description: `Receipt unlocked: ${unlockedPayment.receiptNumber}`,
    user: req.user,
    entityId: updated._id,
    entityLabel: unlockedPayment.receiptNumber
  });

  res.json(await populateInvoice(updated._id));
});

exports.feeHistory = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.student) filter.student = req.query.student;
  if (req.query.academicYear) filter.academicYear = req.query.academicYear;

  if (req.user.role === ROLES.STUDENT) filter.student = req.user.student;
  if (req.user.role === ROLES.PARENT) {
    const childIds = req.user.linkedStudents?.length ? req.user.linkedStudents : (req.user.linkedStudent ? [req.user.linkedStudent] : []);
    filter.student = req.query.student && childIds.map(String).includes(String(req.query.student))
      ? req.query.student
      : { $in: childIds };
  }

  let history = await listFeeHistory(filter);

  if (req.query.page || req.query.pageSize || req.query.search || req.query.paymentStatus) {
    const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
    const paginated = await listFeeHistoryPaginated({
      filter,
      search: req.query.search,
      paymentStatus: req.query.paymentStatus,
      skip,
      limit: pageSize
    });
    return sendPaginated(res, paginated.rows, { page, pageSize, totalItems: paginated.totalItems });
  }

  if (req.query.search) {
    const term = req.query.search.trim().toLowerCase();
    history = history.filter((row) => {
      const studentName = [row.student?.firstName, row.student?.lastName].filter(Boolean).join(' ').toLowerCase();
      return `${row.receiptNumber || ''} ${row.invoiceNumber || ''} ${studentName}`.toLowerCase().includes(term);
    });
  }
  if (req.query.paymentStatus) {
    history = history.filter((row) => row.paymentStatus === req.query.paymentStatus);
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const totalItems = history.length;
  const slice = history.slice(skip, skip + pageSize);
  return sendPaginated(res, slice, { page, pageSize, totalItems });
});

exports.downloadInvoice = asyncHandler(async (req, res) => {
  const invoice = await populateInvoice(req.params.id);
  if (!invoice) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Invoice not found' });
  assertInvoiceAccess(req, invoice);
  feeInvoicePdf(res, invoice);
});

exports.downloadReceipt = asyncHandler(async (req, res) => {
  const invoice = await populateInvoice(req.params.id);
  if (!invoice) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Invoice not found' });
  assertInvoiceAccess(req, invoice);

  const payment = invoice.payments.id(req.params.paymentId);
  if (!payment) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Receipt not found' });

  feeReceiptPdf(res, invoice, payment);
});

exports.createDemandForStudent = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.studentId);
  if (!student) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Student not found' });

  const { academicYear, classRoom, year, month } = req.body;
  const targetYear = year || new Date().getFullYear();
  const targetMonth = month || new Date().getMonth() + 1;

  const invoice = await createDemandForStudent(student, academicYear, classRoom, targetYear, targetMonth);
  res.status(HTTP_STATUS.CREATED).json(await populateInvoice(invoice._id));
});

// Used by student admission flow
exports.generateAdmissionDemand = async function generateAdmissionDemand(student, academicYearId, classRoomId, user) {
  const now = new Date();
  try {
    const invoice = await createDemandForStudent(
      student,
      academicYearId,
      classRoomId,
      now.getFullYear(),
      now.getMonth() + 1
    );
    logEntityCreate({
      module: FEE_MODULE,
      entityId: invoice._id,
      entityLabel: invoice.invoiceNumber,
      action: 'fee_demand_generation',
      description: `Admission fee demand generated: ${invoice.invoiceNumber}`,
      user,
      meta: { student: student._id, admissionNumber: student.admissionNumber }
    });
    return invoice;
  } catch (error) {
    if (error.code === 'DUPLICATE_DEMAND') return null;
    throw error;
  }
};
