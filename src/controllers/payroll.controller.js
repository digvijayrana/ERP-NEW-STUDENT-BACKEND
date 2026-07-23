const Payroll = require('../models/Payroll');
const Teacher = require('../models/Teacher');
const asyncHandler = require('../middleware/asyncHandler');
const { payrollPdf } = require('../services/pdf.service');
const {
  PAYROLL_MODULE,
  createPayroll,
  updatePayroll,
  markPayrollPaid,
  removePayroll,
  unlockPayroll,
  previewPayroll
} = require('../services/payroll.service');
const { logEntityUpdate } = require('../services/activityLog.service');
const { assertReversalAllowed, logUnlock } = require('../services/businessRules.service');
const { HTTP_STATUS, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');

const PAYROLL_SORT_FIELDS = ['year', 'month', 'status', 'createdAt', 'paidAt'];

function logPayrollActivity({ action, description, user, entityId, entityLabel, meta }) {
  logEntityUpdate({
    module: PAYROLL_MODULE,
    entityId,
    entityLabel,
    action,
    description,
    user,
    meta
  });
}

function auditContext(user) {
  return { module: PAYROLL_MODULE, user };
}

exports.create = asyncHandler(async (req, res) => {
  const payroll = await createPayroll(req.body, req.user);

  logPayrollActivity({
    action: 'payroll_create',
    description: `Payroll created for ${payroll.month}/${payroll.year}`,
    user: req.user,
    entityId: payroll._id,
    entityLabel: `${payroll.month}/${payroll.year}`,
    meta: { teacherId: payroll.teacher?._id || payroll.teacher }
  });

  res.status(HTTP_STATUS.CREATED).json(payroll);
});

exports.preview = asyncHandler(async (req, res) => {
  const teacher = req.body?.teacher || req.query.teacher;
  const month = req.body?.month || req.query.month;
  const year = req.body?.year || req.query.year;
  if (!teacher || !month || !year) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      message: 'teacher, month and year are required',
      code: 'BAD_REQUEST'
    });
  }
  const preview = await previewPayroll(teacher, month, year);
  res.json(preview);
});

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.teacher) filter.teacher = req.query.teacher;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.month) filter.month = Number(req.query.month);
  if (req.query.year) filter.year = Number(req.query.year);

  if (req.query.search) {
    const term = req.query.search.trim();
    const regex = new RegExp(term, 'i');
    const teachers = await Teacher.find({
      $or: [{ employeeCode: regex }, { firstName: regex }, { lastName: regex }]
    }).distinct('_id');
    filter.teacher = { $in: teachers };
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, PAYROLL_SORT_FIELDS, 'year');

  const [payrolls, totalItems] = await Promise.all([
    Payroll.find(filter).populate('teacher', 'firstName lastName employeeCode').sort(sort).skip(skip).limit(pageSize),
    Payroll.countDocuments(filter)
  ]);

  return sendPaginated(res, payrolls, { page, pageSize, totalItems });
});

exports.markPaid = asyncHandler(async (req, res) => {
  const payroll = await markPayrollPaid(req.params.id, req.body, req.user, auditContext(req.user));

  logPayrollActivity({
    action: 'payroll_paid',
    description: `Payroll marked paid for ${payroll.month}/${payroll.year}`,
    user: req.user,
    entityId: payroll._id,
    entityLabel: `${payroll.month}/${payroll.year}`,
    meta: { paidAt: payroll.paidAt, locked: payroll.locked }
  });

  res.json(payroll);
});

exports.update = asyncHandler(async (req, res) => {
  const payroll = await updatePayroll(req.params.id, req.body, req.user, auditContext(req.user));

  logPayrollActivity({
    action: 'payroll_update',
    description: `Payroll updated for ${payroll.month}/${payroll.year}`,
    user: req.user,
    entityId: payroll._id,
    entityLabel: `${payroll.month}/${payroll.year}`
  });

  res.json(payroll);
});

exports.remove = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findById(req.params.id);
  if (!payroll) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Payroll record not found' });

  await removePayroll(req.params.id, req.user, auditContext(req.user));

  logPayrollActivity({
    action: 'payroll_delete',
    description: `Payroll deleted for ${payroll.month}/${payroll.year}`,
    user: req.user,
    entityId: payroll._id,
    entityLabel: `${payroll.month}/${payroll.year}`
  });

  res.json({ deleted: true });
});

exports.unlock = asyncHandler(async (req, res) => {
  assertReversalAllowed('payroll_unlock', req.user, req.permissions);
  const existing = await Payroll.findById(req.params.id);
  if (!existing) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Payroll record not found' });
  const previousValue = { status: existing.status, locked: existing.locked };
  const payroll = await unlockPayroll(req.params.id, req.user);

  logUnlock({
    module: PAYROLL_MODULE,
    entityId: payroll._id,
    entityLabel: `${payroll.month}/${payroll.year}`,
    user: req.user,
    req,
    previousValue,
    updatedValue: { status: payroll.status, locked: payroll.locked }
  });

  logPayrollActivity({
    action: 'payroll_unlock',
    description: `Payroll unlocked for ${payroll.month}/${payroll.year}`,
    user: req.user,
    entityId: payroll._id,
    entityLabel: `${payroll.month}/${payroll.year}`
  });

  res.json(payroll);
});

exports.download = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findById(req.params.id).populate('teacher', 'firstName lastName employeeCode');
  if (!payroll) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Payroll record not found' });
  payrollPdf(res, payroll);
});
