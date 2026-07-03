const FeeInvoice = require('../models/FeeInvoice');
const Student = require('../models/Student');
const asyncHandler = require('../middleware/asyncHandler');
const { feeInvoicePdf } = require('../services/pdf.service');
const { nextInvoiceNumber } = require('../services/sequence.service');

exports.createInvoice = asyncHandler(async (req, res) => {
  res.status(201).json(
    await FeeInvoice.create({
      ...req.body,
      invoiceNumber: await nextInvoiceNumber()
    })
  );
});

exports.createBulkMonthlyInvoices = asyncHandler(async (req, res) => {
  const { academicYear, classRoom, dueDate, label, amount } = req.body;
  const students = await Student.find({
    enrollments: { $elemMatch: { academicYear, classRoom, status: 'studying' } }
  }).select('_id admissionNumber');

  const invoicePayloads = await Promise.all(
    students.map(async (student) => ({
      student: student._id,
      academicYear,
      classRoom,
      invoiceNumber: await nextInvoiceNumber(),
      dueDate,
      items: [{ label: label || 'Monthly fee', amount }]
    }))
  );
  const invoices = await FeeInvoice.insertMany(invoicePayloads);

  res.status(201).json({ created: invoices.length });
});

exports.listInvoices = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.student) filter.student = req.query.student;
  if (req.query.status) filter.status = req.query.status;
  if (req.user.role === 'student') filter.student = req.user.student;
  if (req.user.role === 'parent' && req.user.linkedStudent) filter.student = req.user.linkedStudent;

  const invoices = await FeeInvoice.find(filter)
    .populate('student', 'firstName lastName admissionNumber')
    .populate('classRoom', 'name section')
    .populate('academicYear', 'name')
    .sort({ dueDate: -1 });
  res.json(invoices);
});

exports.addPayment = asyncHandler(async (req, res) => {
  const invoice = await FeeInvoice.findById(req.params.id);
  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

  invoice.payments.push(req.body);
  await invoice.save();
  res.status(201).json(invoice);
});

exports.downloadInvoice = asyncHandler(async (req, res) => {
  const invoice = await FeeInvoice.findById(req.params.id)
    .populate('student', 'firstName lastName admissionNumber')
    .populate('classRoom', 'name section')
    .populate('academicYear', 'name');
  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
  if (req.user.role === 'student' && invoice.student._id.toString() !== req.user.student?.toString()) {
    return res.status(403).json({ message: 'Students can download only their own fee invoice' });
  }
  if (req.user.role === 'parent' && invoice.student._id.toString() !== req.user.linkedStudent?.toString()) {
    return res.status(403).json({ message: 'Parents can download only their linked child fee invoice' });
  }
  feeInvoicePdf(res, invoice);
});
