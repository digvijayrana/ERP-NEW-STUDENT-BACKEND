const Payroll = require('../models/Payroll');
const asyncHandler = require('../middleware/asyncHandler');
const { payrollPdf } = require('../services/pdf.service');
const { HTTP_STATUS } = require('../constants');

exports.create = asyncHandler(async (req, res) => {
  res.status(HTTP_STATUS.CREATED).json(await Payroll.create(req.body));
});

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.teacher) filter.teacher = req.query.teacher;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.month) filter.month = req.query.month;
  if (req.query.year) filter.year = req.query.year;

  const payrolls = await Payroll.find(filter).populate('teacher', 'firstName lastName employeeCode').sort({ year: -1, month: -1 });
  res.json(payrolls);
});

exports.markPaid = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findByIdAndUpdate(
    req.params.id,
    { ...req.body, status: 'paid', paidAt: req.body.paidAt || new Date() },
    { new: true, runValidators: true }
  );
  if (!payroll) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Payroll record not found' });
  res.json(payroll);
});

exports.update = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!payroll) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Payroll record not found' });
  res.json(payroll);
});

exports.remove = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findByIdAndDelete(req.params.id);
  if (!payroll) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Payroll record not found' });
  res.json({ deleted: true });
});

exports.download = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findById(req.params.id).populate('teacher', 'firstName lastName employeeCode');
  if (!payroll) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Payroll record not found' });
  payrollPdf(res, payroll);
});
