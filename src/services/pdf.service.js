const PDFDocument = require('pdfkit');

function pipePdf(res, filename, build) {
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  build(doc);
  doc.end();
}

function money(value) {
  return `INR ${Number(value || 0).toFixed(2)}`;
}

function header(doc, title) {
  doc.fontSize(20).text('Student ERP', { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor('#52616b').text('Enterprise School Management System');
  doc.fillColor('#172026').moveDown(1);
  doc.fontSize(16).text(title);
  doc.moveDown();
}

exports.feeInvoicePdf = function feeInvoicePdf(res, invoice) {
  pipePdf(res, `${invoice.invoiceNumber}.pdf`, (doc) => {
    header(doc, 'Fee Invoice / Receipt');
    doc.fontSize(11);
    doc.text(`Invoice No: ${invoice.invoiceNumber}`);
    doc.text(`Student: ${invoice.student?.firstName || ''} ${invoice.student?.lastName || ''}`);
    doc.text(`Admission No: ${invoice.student?.admissionNumber || ''}`);
    doc.text(`Class: ${invoice.classRoom?.name || ''}-${invoice.classRoom?.section || ''}`);
    doc.text(`Academic Year: ${invoice.academicYear?.name || ''}`);
    doc.text(`Due Date: ${invoice.dueDate ? invoice.dueDate.toDateString() : ''}`);
    doc.moveDown();

    doc.fontSize(12).text('Fee Details');
    doc.moveDown(0.4);
    invoice.items.forEach((item) => {
      doc.text(`${item.label}`, { continued: true }).text(money(item.amount), { align: 'right' });
    });
    doc.text('Discount', { continued: true }).text(money(invoice.discount), { align: 'right' });
    doc.text('Fine', { continued: true }).text(money(invoice.fine), { align: 'right' });
    doc.moveDown();
    doc.fontSize(12).text(`Total: ${money(invoice.totalAmount)}`);
    doc.text(`Paid: ${money(invoice.paidAmount)}`);
    doc.text(`Balance: ${money(invoice.balanceAmount)}`);
    doc.text(`Status: ${invoice.status.toUpperCase()}`);
  });
};

exports.payrollPdf = function payrollPdf(res, payroll) {
  pipePdf(res, `payroll-${payroll.teacher?.employeeCode || payroll._id}-${payroll.month}-${payroll.year}.pdf`, (doc) => {
    header(doc, 'Teacher Salary Slip');
    doc.fontSize(11);
    doc.text(`Teacher: ${payroll.teacher?.firstName || ''} ${payroll.teacher?.lastName || ''}`);
    doc.text(`Employee Code: ${payroll.teacher?.employeeCode || ''}`);
    doc.text(`Month/Year: ${payroll.month}/${payroll.year}`);
    doc.text(`Status: ${payroll.status.toUpperCase()}`);
    doc.moveDown();
    doc.text('Basic Salary', { continued: true }).text(money(payroll.basicSalary), { align: 'right' });
    doc.text('Allowances', { continued: true }).text(money(payroll.allowances), { align: 'right' });
    doc.text('Deductions', { continued: true }).text(money(payroll.deductions), { align: 'right' });
    doc.moveDown();
    doc.fontSize(13).text(`Net Salary: ${money(payroll.netSalary)}`);
    if (payroll.paidAt) doc.fontSize(11).text(`Paid At: ${payroll.paidAt.toDateString()}`);
  });
};
