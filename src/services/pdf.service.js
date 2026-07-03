const PDFDocument = require('pdfkit');

const COLORS = {
  PRIMARY: '#1a237e',
  SECONDARY: '#283593',
  ACCENT: '#1565c0',
  TEXT: '#212121',
  MUTED: '#616161',
  LIGHT: '#e8eaf6',
  BORDER: '#9fa8da',
  WHITE: '#ffffff',
  SUCCESS: '#2e7d32',
  DANGER: '#c62828'
};

const PAGE_MARGIN = 48;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;
const COL_LEFT = PAGE_MARGIN;
const COL_RIGHT = 595.28 - PAGE_MARGIN;

function schoolConfig() {
  return {
    name: process.env.SCHOOL_NAME || 'Student ERP School',
    address: process.env.SCHOOL_ADDRESS || '123 Education Street, City - 000000',
    phone: process.env.SCHOOL_PHONE || '',
    email: process.env.SCHOOL_EMAIL || '',
    website: process.env.SCHOOL_WEBSITE || '',
    affiliation: process.env.SCHOOL_AFFILIATION || ''
  };
}

function pipePdf(res, filename, build) {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  build(doc);
  doc.end();
}

function money(value) {
  const num = Number(value || 0);
  return `₹ ${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function drawLine(doc, y, color) {
  doc.moveTo(COL_LEFT, y).lineTo(COL_RIGHT, y).strokeColor(color || COLORS.BORDER).lineWidth(1).stroke();
}

function drawThickLine(doc, y) {
  doc.moveTo(COL_LEFT, y).lineTo(COL_RIGHT, y).strokeColor(COLORS.PRIMARY).lineWidth(2.5).stroke();
}

function schoolHeader(doc) {
  const school = schoolConfig();
  const startY = doc.y;

  doc.rect(COL_LEFT, startY, CONTENT_WIDTH, 75).fill(COLORS.PRIMARY);

  doc.fontSize(22).fillColor(COLORS.WHITE).font('Helvetica-Bold')
    .text(school.name.toUpperCase(), COL_LEFT + 16, startY + 12, { width: CONTENT_WIDTH - 32, align: 'center' });

  doc.fontSize(9).fillColor('#c5cae9').font('Helvetica')
    .text(school.address, COL_LEFT + 16, startY + 40, { width: CONTENT_WIDTH - 32, align: 'center' });

  const contactParts = [school.phone, school.email, school.website].filter(Boolean);
  if (contactParts.length) {
    doc.fontSize(8).fillColor('#c5cae9')
      .text(contactParts.join('  |  '), COL_LEFT + 16, startY + 54, { width: CONTENT_WIDTH - 32, align: 'center' });
  }

  doc.y = startY + 80;

  if (school.affiliation) {
    doc.fontSize(8).fillColor(COLORS.MUTED).font('Helvetica-Oblique')
      .text(school.affiliation, { align: 'center' });
    doc.font('Helvetica');
  }

  doc.moveDown(0.5);
  drawThickLine(doc, doc.y);
  doc.moveDown(0.8);
  doc.fillColor(COLORS.TEXT);
}

function documentTitle(doc, title) {
  const y = doc.y;
  doc.rect(COL_LEFT, y, CONTENT_WIDTH, 28).fill(COLORS.LIGHT);
  doc.fontSize(13).fillColor(COLORS.PRIMARY).font('Helvetica-Bold')
    .text(title.toUpperCase(), COL_LEFT + 12, y + 7, { width: CONTENT_WIDTH - 24 });
  doc.font('Helvetica').fillColor(COLORS.TEXT);
  doc.y = y + 34;
  doc.moveDown(0.4);
}

function labelValue(doc, label, value, x, y, labelWidth) {
  const lw = labelWidth || 110;
  doc.fontSize(9).fillColor(COLORS.MUTED).font('Helvetica-Bold')
    .text(label, x, y, { width: lw });
  doc.fontSize(10).fillColor(COLORS.TEXT).font('Helvetica')
    .text(value || '—', x + lw, y, { width: 200 });
}

function tableRow(doc, label, amount, y, options) {
  const opts = options || {};
  const isBold = opts.bold;
  const bg = opts.bg;
  if (bg) {
    doc.rect(COL_LEFT, y - 2, CONTENT_WIDTH, 18).fill(bg);
  }
  doc.fontSize(opts.fontSize || 10)
    .fillColor(opts.color || COLORS.TEXT)
    .font(isBold ? 'Helvetica-Bold' : 'Helvetica')
    .text(label, COL_LEFT + 12, y, { width: CONTENT_WIDTH - 130 })
    .text(amount, COL_LEFT + 12, y, { width: CONTENT_WIDTH - 24, align: 'right' });
  doc.font('Helvetica').fillColor(COLORS.TEXT);
}

function footer(doc) {
  const school = schoolConfig();
  const y = doc.page.height - PAGE_MARGIN - 40;
  drawLine(doc, y, COLORS.BORDER);
  doc.fontSize(7).fillColor(COLORS.MUTED)
    .text('This is a computer-generated document. No signature is required.', COL_LEFT, y + 8, { width: CONTENT_WIDTH, align: 'center' })
    .text(`${school.name} | Generated on ${formatDate(new Date())}`, COL_LEFT, y + 20, { width: CONTENT_WIDTH, align: 'center' });
}

exports.feeInvoicePdf = function feeInvoicePdf(res, invoice) {
  pipePdf(res, `${invoice.invoiceNumber}.pdf`, (doc) => {
    schoolHeader(doc);
    documentTitle(doc, 'Fee Invoice / Receipt');

    const detailY = doc.y;
    const midX = COL_LEFT + CONTENT_WIDTH / 2;

    labelValue(doc, 'Invoice No:', invoice.invoiceNumber, COL_LEFT, detailY);
    labelValue(doc, 'Due Date:', formatDate(invoice.dueDate), midX, detailY);

    labelValue(doc, 'Student:', `${invoice.student?.firstName || ''} ${invoice.student?.lastName || ''}`.trim(), COL_LEFT, detailY + 18);
    labelValue(doc, 'Status:', (invoice.status || '').toUpperCase(), midX, detailY + 18);

    labelValue(doc, 'Admission No:', invoice.student?.admissionNumber || '', COL_LEFT, detailY + 36);
    labelValue(doc, 'Academic Year:', invoice.academicYear?.name || '', midX, detailY + 36);

    labelValue(doc, 'Class:', `${invoice.classRoom?.name || ''}-${invoice.classRoom?.section || ''}`, COL_LEFT, detailY + 54);

    doc.y = detailY + 80;
    drawLine(doc, doc.y);
    doc.moveDown(0.6);

    let rowY = doc.y;
    tableRow(doc, 'DESCRIPTION', 'AMOUNT', rowY, { bold: true, bg: COLORS.LIGHT, color: COLORS.PRIMARY, fontSize: 9 });
    rowY += 22;
    drawLine(doc, rowY - 2);

    invoice.items.forEach((item) => {
      tableRow(doc, item.label, money(item.amount), rowY);
      rowY += 20;
    });

    drawLine(doc, rowY - 2, '#e0e0e0');

    if (invoice.discount > 0) {
      tableRow(doc, 'Discount', `- ${money(invoice.discount)}`, rowY, { color: COLORS.SUCCESS });
      rowY += 20;
    }
    if (invoice.fine > 0) {
      tableRow(doc, 'Fine / Late charge', `+ ${money(invoice.fine)}`, rowY, { color: COLORS.DANGER });
      rowY += 20;
    }

    drawLine(doc, rowY - 2);
    rowY += 4;
    tableRow(doc, 'TOTAL AMOUNT', money(invoice.totalAmount), rowY, { bold: true, bg: COLORS.PRIMARY, color: COLORS.WHITE, fontSize: 11 });
    rowY += 26;
    tableRow(doc, 'Amount Paid', money(invoice.paidAmount), rowY, { color: COLORS.SUCCESS });
    rowY += 20;

    const balColor = invoice.balanceAmount > 0 ? COLORS.DANGER : COLORS.SUCCESS;
    tableRow(doc, 'Balance Due', money(invoice.balanceAmount), rowY, { bold: true, color: balColor, fontSize: 11 });
    rowY += 28;

    const statusColor = invoice.status === 'paid' ? COLORS.SUCCESS : invoice.status === 'partial' ? '#ef6c00' : COLORS.DANGER;
    doc.roundedRect(COL_RIGHT - 100, rowY, 88, 22, 4).fill(statusColor);
    doc.fontSize(11).fillColor(COLORS.WHITE).font('Helvetica-Bold')
      .text((invoice.status || '').toUpperCase(), COL_RIGHT - 96, rowY + 5, { width: 80, align: 'center' });
    doc.font('Helvetica').fillColor(COLORS.TEXT);

    if (invoice.payments?.length) {
      doc.y = rowY + 40;
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor(COLORS.PRIMARY).font('Helvetica-Bold').text('Payment History');
      doc.font('Helvetica').fillColor(COLORS.TEXT);
      doc.moveDown(0.3);

      let py = doc.y;
      tableRow(doc, 'DATE / MODE', 'AMOUNT', py, { bold: true, bg: COLORS.LIGHT, color: COLORS.PRIMARY, fontSize: 9 });
      py += 20;

      invoice.payments.forEach((p) => {
        const pLabel = `${formatDate(p.paidAt)}  —  ${(p.mode || 'cash').toUpperCase()}${p.referenceNumber ? ` (Ref: ${p.referenceNumber})` : ''}`;
        tableRow(doc, pLabel, money(p.amount), py);
        py += 18;
      });
    }

    footer(doc);
  });
};

exports.payrollPdf = function payrollPdf(res, payroll) {
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthLabel = `${monthNames[payroll.month] || payroll.month} ${payroll.year}`;

  pipePdf(res, `payroll-${payroll.teacher?.employeeCode || payroll._id}-${payroll.month}-${payroll.year}.pdf`, (doc) => {
    schoolHeader(doc);
    documentTitle(doc, 'Salary Slip');

    const detailY = doc.y;
    const midX = COL_LEFT + CONTENT_WIDTH / 2;

    labelValue(doc, 'Employee:', `${payroll.teacher?.firstName || ''} ${payroll.teacher?.lastName || ''}`.trim(), COL_LEFT, detailY);
    labelValue(doc, 'Month:', monthLabel, midX, detailY);

    labelValue(doc, 'Employee Code:', payroll.teacher?.employeeCode || '', COL_LEFT, detailY + 20);
    labelValue(doc, 'Status:', (payroll.status || '').toUpperCase(), midX, detailY + 20);

    if (payroll.paidAt) {
      labelValue(doc, 'Paid On:', formatDate(payroll.paidAt), COL_LEFT, detailY + 40);
    }

    doc.y = detailY + 65;
    drawLine(doc, doc.y);
    doc.moveDown(0.6);

    let rowY = doc.y;
    tableRow(doc, 'COMPONENT', 'AMOUNT', rowY, { bold: true, bg: COLORS.LIGHT, color: COLORS.PRIMARY, fontSize: 9 });
    rowY += 22;
    drawLine(doc, rowY - 2);

    tableRow(doc, 'Basic Salary', money(payroll.basicSalary), rowY);
    rowY += 20;

    tableRow(doc, 'Allowances', `+ ${money(payroll.allowances)}`, rowY, { color: COLORS.SUCCESS });
    rowY += 20;

    tableRow(doc, 'Deductions', `- ${money(payroll.deductions)}`, rowY, { color: COLORS.DANGER });
    rowY += 20;

    drawLine(doc, rowY - 2);
    rowY += 4;

    tableRow(doc, 'NET SALARY', money(payroll.netSalary), rowY, { bold: true, bg: COLORS.PRIMARY, color: COLORS.WHITE, fontSize: 12 });
    rowY += 28;

    const statusColor = payroll.status === 'paid' ? COLORS.SUCCESS : '#ef6c00';
    doc.roundedRect(COL_RIGHT - 100, rowY, 88, 22, 4).fill(statusColor);
    doc.fontSize(11).fillColor(COLORS.WHITE).font('Helvetica-Bold')
      .text((payroll.status || '').toUpperCase(), COL_RIGHT - 96, rowY + 5, { width: 80, align: 'center' });
    doc.font('Helvetica').fillColor(COLORS.TEXT);

    rowY += 50;
    doc.y = rowY;
    drawLine(doc, rowY, '#e0e0e0');
    doc.moveDown(2);

    const sigY = doc.y;
    doc.fontSize(9).fillColor(COLORS.MUTED);
    drawLine(doc, sigY, COLORS.TEXT);
    doc.text('Employee Signature', COL_LEFT, sigY + 4, { width: CONTENT_WIDTH / 2 - 20 });
    drawLine(doc, sigY);
    doc.text('Authorized Signatory', midX + 20, sigY + 4, { width: CONTENT_WIDTH / 2 - 20, align: 'right' });

    footer(doc);
  });
};
