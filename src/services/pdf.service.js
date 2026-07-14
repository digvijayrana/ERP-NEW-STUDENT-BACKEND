const PDFDocument = require('pdfkit');

// Teal palette matching the app theme (primary #0d9488 / bright #14b8a6 / deep #05191d).
const C = {
  NAVY: '#0f2e2b',
  ROYAL: '#0f766e',
  BLUE: '#0d9488',
  SKY: '#14b8a6',
  LIGHT_BLUE: '#99f6e4',
  ICE: '#f0fdfa',
  GOLD: '#5eead4',
  GOLD_LIGHT: '#ccfbf1',
  TEXT: '#1e293b',
  MUTED: '#64748b',
  LIGHT_GRAY: '#f1f5f9',
  BORDER: '#cbd5e1',
  WHITE: '#ffffff',
  GREEN: '#16a34a',
  GREEN_SOFT: '#dcfce7',
  RED: '#dc2626',
  RED_SOFT: '#fee2e2',
  ORANGE: '#ea580c',
  ORANGE_SOFT: '#ffedd5'
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const W = PAGE_W - M * 2;
const LEFT = M;
const RIGHT = PAGE_W - M;
const MID = LEFT + W / 2;

function school() {
  try {
    const { getCachedSchoolBranding } = require('./governanceConfig.service');
    return getCachedSchoolBranding();
  } catch {
    return {
      name: process.env.SCHOOL_NAME || 'Student ERP School',
      address: process.env.SCHOOL_ADDRESS || '123 Education Street, City - 000000',
      phone: process.env.SCHOOL_PHONE || '',
      email: process.env.SCHOOL_EMAIL || '',
      website: process.env.SCHOOL_WEBSITE || '',
      affiliation: process.env.SCHOOL_AFFILIATION || ''
    };
  }
}

function pipePdf(res, filename, build) {
  try {
    const doc = new PDFDocument({ margin: M, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    doc.pipe(res);
    build(doc);
    doc.end();
  } catch (err) {
    console.error('PDF generation error:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'PDF generation failed', error: err.message });
    }
  }
}

function rupees(value) {
  const n = Number(value || 0);
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toHex(n) {
  return n.toString(16).padStart(2, '0');
}

function gradientBand(doc, y, h) {
  // Deep teal (#0a2a33) -> bright teal (#14b8a6), matching the app shell/sidebar.
  const steps = 20;
  const stepW = W / steps;
  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const r = Math.round(10 + ratio * (20 - 10));
    const g = Math.round(42 + ratio * (184 - 42));
    const b = Math.round(51 + ratio * (166 - 51));
    doc.rect(LEFT + i * stepW, y, stepW + 1, h).fill(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
  }
}

function goldAccentLine(doc, y) {
  doc.rect(LEFT, y, W, 3).fill(C.GOLD);
}

function headerBlock(doc) {
  const s = school();
  const topY = M;

  gradientBand(doc, topY, 85);

  doc.rect(LEFT + W - 70, topY + 8, 56, 56).lineWidth(2).strokeColor(C.GOLD).stroke();
  doc.fontSize(7).fillColor(C.GOLD).font('Helvetica-Bold')
    .text('SCHOOL', LEFT + W - 66, topY + 22, { width: 48, align: 'center' })
    .text('LOGO', LEFT + W - 66, topY + 32, { width: 48, align: 'center' });

  doc.fontSize(24).fillColor(C.WHITE).font('Helvetica-Bold')
    .text(s.name.toUpperCase(), LEFT + 20, topY + 14, { width: W - 100 });

  doc.fontSize(9).fillColor('#99f6e4').font('Helvetica')
    .text(s.address, LEFT + 20, topY + 46, { width: W - 100 });

  const contact = [s.phone, s.email, s.website].filter(Boolean);
  if (contact.length) {
    doc.fontSize(8).fillColor('#99f6e4')
      .text(contact.join('   ·   '), LEFT + 20, topY + 60, { width: W - 100 });
  }

  goldAccentLine(doc, topY + 85);

  if (s.affiliation) {
    doc.fontSize(7.5).fillColor(C.MUTED).font('Helvetica-Oblique')
      .text(s.affiliation, LEFT, topY + 90, { width: W, align: 'right' });
    doc.font('Helvetica');
    doc.y = topY + 100;
  } else {
    doc.y = topY + 92;
  }

  doc.fillColor(C.TEXT);
}

function docTitle(doc, title, subtitle) {
  const y = doc.y;
  doc.rect(LEFT, y, W, 30).fill(C.ICE);
  doc.rect(LEFT, y, 4, 30).fill(C.BLUE);
  doc.fontSize(13).fillColor(C.NAVY).font('Helvetica-Bold')
    .text(title.toUpperCase(), LEFT + 14, y + 4, { width: W - 140 });
  if (subtitle) {
    doc.fontSize(8).fillColor(C.MUTED).font('Helvetica')
      .text(subtitle, LEFT + 14, y + 19, { width: W - 140 });
  }
  doc.font('Helvetica').fillColor(C.TEXT);
  doc.y = y + 34;
}

function infoBox(doc, label, value, x, y, w) {
  doc.rect(x, y, w, 36).fill(C.LIGHT_GRAY);
  doc.rect(x, y, w, 36).lineWidth(0.5).strokeColor(C.BORDER).stroke();
  doc.fontSize(7).fillColor(C.MUTED).font('Helvetica-Bold')
    .text(label.toUpperCase(), x + 8, y + 5, { width: w - 16 });
  doc.fontSize(10).fillColor(C.TEXT).font('Helvetica')
    .text(value || '—', x + 8, y + 18, { width: w - 16 });
}

function tableHeader(doc, cols, y) {
  gradientBand(doc, y, 22);
  doc.fontSize(8).fillColor(C.WHITE).font('Helvetica-Bold');
  cols.forEach((col) => {
    doc.text(col.label.toUpperCase(), col.x, y + 6, { width: col.w, align: col.align || 'left' });
  });
  doc.font('Helvetica').fillColor(C.TEXT);
  return y + 24;
}

function tableDataRow(doc, cols, y, opts) {
  const o = opts || {};
  if (o.striped) doc.rect(LEFT, y - 1, W, 20).fill(C.ICE);
  doc.fontSize(o.fontSize || 10).fillColor(o.color || C.TEXT).font(o.bold ? 'Helvetica-Bold' : 'Helvetica');
  cols.forEach((col) => {
    doc.text(col.text, col.x, y + 4, { width: col.w, align: col.align || 'left' });
  });
  doc.font('Helvetica').fillColor(C.TEXT);
  return y + 22;
}

function totalBand(doc, label, amount, y) {
  gradientBand(doc, y, 26);
  doc.fontSize(12).fillColor(C.WHITE).font('Helvetica-Bold')
    .text(label, LEFT + 14, y + 6, { width: W - 140 })
    .text(amount, LEFT + 14, y + 6, { width: W - 28, align: 'right' });
  doc.font('Helvetica').fillColor(C.TEXT);
  return y + 30;
}

function summaryRow(doc, label, amount, y, opts) {
  const o = opts || {};
  doc.fontSize(o.fontSize || 10).fillColor(o.color || C.TEXT).font(o.bold ? 'Helvetica-Bold' : 'Helvetica')
    .text(label, LEFT + 14, y, { width: W - 140 })
    .text(amount, LEFT + 14, y, { width: W - 28, align: 'right' });
  doc.font('Helvetica').fillColor(C.TEXT);
  return y + 20;
}

function statusPill(doc, status, x, y) {
  const map = { paid: C.GREEN, partial: C.ORANGE, pending: C.ORANGE, unpaid: C.RED, cancelled: C.MUTED };
  const bgMap = { paid: C.GREEN_SOFT, partial: C.ORANGE_SOFT, pending: C.ORANGE_SOFT, unpaid: C.RED_SOFT, cancelled: C.LIGHT_GRAY };
  const color = map[status] || C.MUTED;
  const bg = bgMap[status] || C.LIGHT_GRAY;
  const label = (status || '').toUpperCase();
  const pw = 80;
  doc.roundedRect(x, y, pw, 24, 12).fill(bg);
  doc.roundedRect(x, y, pw, 24, 12).lineWidth(1).strokeColor(color).stroke();
  doc.fontSize(10).fillColor(color).font('Helvetica-Bold')
    .text(label, x, y + 6, { width: pw, align: 'center' });
  doc.font('Helvetica').fillColor(C.TEXT);
}

function watermark(doc, text) {
  doc.save();
  doc.fillOpacity(0.08);
  doc.fontSize(80).fillColor(C.LIGHT_BLUE).font('Helvetica-Bold')
    .text(text.toUpperCase(), LEFT, PAGE_H / 2 - 60, { width: W, align: 'center' });
  doc.fillOpacity(1);
  doc.restore();
}

function footerBlock(doc) {
  const s = school();
  const y = PAGE_H - M - 50;
  doc.rect(LEFT, y, W, 0.5).fill(C.BORDER);
  doc.rect(LEFT, y + 0.5, W, 2).fill(C.GOLD);

  doc.fontSize(7).fillColor(C.MUTED).font('Helvetica-Oblique')
    .text('This is a system-generated document and does not require a physical signature.', LEFT, y + 10, { width: W, align: 'center' });
  doc.font('Helvetica')
    .text(`${s.name}  ·  ${s.address}  ·  Generated on ${fmtDate(new Date())}`, LEFT, y + 22, { width: W, align: 'center' });

  doc.rect(LEFT, y + 36, W, 3).fill(C.NAVY);
}

exports.feeInvoicePdf = function feeInvoicePdf(res, invoice) {
  pipePdf(res, `${invoice.invoiceNumber}.pdf`, (doc) => {
    headerBlock(doc);

    if (invoice.status === 'paid') watermark(doc, 'Paid');

    docTitle(doc, 'Fee Invoice', `Invoice No: ${invoice.invoiceNumber}  |  Date: ${fmtDate(new Date())}`);

    const bx = doc.y;
    const bw = (W - 12) / 3;
    infoBox(doc, 'Student Name', `${invoice.student?.firstName || ''} ${invoice.student?.lastName || ''}`.trim(), LEFT, bx, bw);
    infoBox(doc, 'Admission No', invoice.student?.admissionNumber || '', LEFT + bw + 6, bx, bw);
    infoBox(doc, 'Class / Section', `${invoice.classRoom?.name || ''}-${invoice.classRoom?.section || ''}`, LEFT + (bw + 6) * 2, bx, bw);

    const bx2 = bx + 42;
    infoBox(doc, 'Academic Year', invoice.academicYear?.name || '', LEFT, bx2, bw);
    infoBox(doc, 'Due Date', fmtDate(invoice.dueDate), LEFT + bw + 6, bx2, bw);
    infoBox(doc, 'Payment Status', (invoice.status || '').toUpperCase(), LEFT + (bw + 6) * 2, bx2, bw);

    doc.y = bx2 + 50;

    const descCol = { x: LEFT + 14, w: W - 140, label: 'Description' };
    const amtCol = { x: LEFT + 14, w: W - 28, label: 'Amount', align: 'right' };
    let y = tableHeader(doc, [descCol, amtCol], doc.y);

    // Build display lines from stored items, but always surface Bus Fee when
    // the invoice carries a busFee amount (older invoices may omit it from items).
    const lineItems = Array.isArray(invoice.items) ? [...invoice.items] : [];
    const hasBusLine = lineItems.some((item) => /bus\s*fee/i.test(String(item.label || '')));
    if (!hasBusLine && Number(invoice.busFee) > 0) {
      // Place bus fee after tuition when present, otherwise append.
      const tuitionIdx = lineItems.findIndex((item) => /tuition/i.test(String(item.label || '')));
      const busLine = { label: 'Bus Fee', amount: invoice.busFee };
      if (tuitionIdx >= 0) lineItems.splice(tuitionIdx + 1, 0, busLine);
      else lineItems.push(busLine);
    }

    lineItems.forEach((item, i) => {
      y = tableDataRow(doc, [
        { text: item.label, x: LEFT + 14, w: W - 140 },
        { text: rupees(item.amount), x: LEFT + 14, w: W - 28, align: 'right' }
      ], y, { striped: i % 2 === 0 });
    });

    if (invoice.discount > 0) {
      y = tableDataRow(doc, [
        { text: 'Discount', x: LEFT + 14, w: W - 140 },
        { text: `- ${rupees(invoice.discount)}`, x: LEFT + 14, w: W - 28, align: 'right' }
      ], y, { color: C.GREEN });
    }
    if (invoice.fine > 0) {
      y = tableDataRow(doc, [
        { text: 'Fine / Late Charge', x: LEFT + 14, w: W - 140 },
        { text: `+ ${rupees(invoice.fine)}`, x: LEFT + 14, w: W - 28, align: 'right' }
      ], y, { color: C.RED });
    }

    y = totalBand(doc, 'TOTAL AMOUNT', rupees(invoice.totalAmount), y + 2);
    y += 4;
    y = summaryRow(doc, 'Amount Paid', rupees(invoice.paidAmount), y, { color: C.GREEN, bold: true });

    const balColor = invoice.balanceAmount > 0 ? C.RED : C.GREEN;
    y = summaryRow(doc, 'Balance Due', rupees(invoice.balanceAmount), y, { color: balColor, bold: true, fontSize: 13 });

    statusPill(doc, invoice.status, RIGHT - 90, y + 4);

    if (invoice.payments?.length) {
      doc.y = y + 40;
      doc.moveDown(0.4);

      const py0 = doc.y;
      doc.rect(LEFT, py0, W, 22).fill(C.LIGHT_BLUE);
      doc.rect(LEFT, py0, 3, 22).fill(C.BLUE);
      doc.fontSize(11).fillColor(C.NAVY).font('Helvetica-Bold')
        .text('Payment History', LEFT + 14, py0 + 5);
      doc.font('Helvetica').fillColor(C.TEXT);

      let py = py0 + 28;
      const dateCol = { x: LEFT + 14, w: W - 140, label: 'Date / Mode' };
      const pAmtCol = { x: LEFT + 14, w: W - 28, label: 'Amount', align: 'right' };
      py = tableHeader(doc, [dateCol, pAmtCol], py);

      invoice.payments.forEach((p, i) => {
        const pLabel = `${fmtDate(p.paidAt)}  —  ${(p.mode || 'cash').toUpperCase()}${p.referenceNumber ? ` (Ref: ${p.referenceNumber})` : ''}`;
        py = tableDataRow(doc, [
          { text: pLabel, x: LEFT + 14, w: W - 140 },
          { text: rupees(p.amount), x: LEFT + 14, w: W - 28, align: 'right' }
        ], py, { striped: i % 2 === 0 });
      });
    }

    footerBlock(doc);
  });
};

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

exports.feeReceiptPdf = function feeReceiptPdf(res, invoice, payment) {
  const monthLabel = MONTHS[invoice.feeMonth] || invoice.feeMonth;
  pipePdf(res, `${payment.receiptNumber}.pdf`, (doc) => {
    headerBlock(doc);

    if (payment.status === 'void') watermark(doc, 'Void');

    docTitle(doc, 'Fee Receipt', `Receipt No: ${payment.receiptNumber}  |  Date: ${fmtDate(payment.paidAt || new Date())}`);

    const bx = doc.y;
    const bw = (W - 12) / 3;
    infoBox(doc, 'Student Name', `${invoice.student?.firstName || ''} ${invoice.student?.lastName || ''}`.trim(), LEFT, bx, bw);
    infoBox(doc, 'Admission No', invoice.student?.admissionNumber || '', LEFT + bw + 6, bx, bw);
    infoBox(doc, 'Class / Section', `${invoice.classRoom?.name || ''}-${invoice.classRoom?.section || ''}`, LEFT + (bw + 6) * 2, bx, bw);

    const bx2 = bx + 42;
    infoBox(doc, 'Academic Year', invoice.academicYear?.name || '', LEFT, bx2, bw);
    infoBox(doc, 'Fee Month', `${monthLabel} ${invoice.feeYear}`, LEFT + bw + 6, bx2, bw);
    infoBox(doc, 'Payment Mode', (payment.mode || 'cash').toUpperCase(), LEFT + (bw + 6) * 2, bx2, bw);

    doc.y = bx2 + 50;

    const descCol = { x: LEFT + 14, w: W - 140, label: 'Description' };
    const amtCol = { x: LEFT + 14, w: W - 28, label: 'Amount', align: 'right' };
    let y = tableHeader(doc, [descCol, amtCol], doc.y);

    const rows = [
      ['Tuition Fee', invoice.tuitionFee],
      ['Bus Fee', invoice.busFee],
      ['Other Charges', invoice.otherCharges],
      ['Previous Pending', invoice.previousPending],
      ['Discount', invoice.discount ? -invoice.discount : 0],
      ['Fine', invoice.fine]
    ].filter(([, amount]) => amount);

    rows.forEach(([label, amount], i) => {
      y = tableDataRow(doc, [
        { text: label, x: LEFT + 14, w: W - 140 },
        { text: amount < 0 ? `- ${rupees(Math.abs(amount))}` : rupees(amount), x: LEFT + 14, w: W - 28, align: 'right' }
      ], y, { striped: i % 2 === 0 });
    });

    y = totalBand(doc, 'TOTAL PAID', rupees(payment.amount), y + 2);
    if (payment.referenceNumber) {
      y = summaryRow(doc, 'Reference No', payment.referenceNumber, y, { color: C.MUTED });
    }
    if (payment.status === 'void') {
      statusPill(doc, 'void', RIGHT - 90, y + 4);
    } else {
      statusPill(doc, 'paid', RIGHT - 90, y + 4);
    }

    footerBlock(doc);
  });
};

exports.payrollPdf = function payrollPdf(res, payroll) {
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const period = `${months[payroll.month] || payroll.month} ${payroll.year}`;

  pipePdf(res, `salary-slip-${payroll.teacher?.employeeCode || payroll._id}-${payroll.month}-${payroll.year}.pdf`, (doc) => {
    headerBlock(doc);

    if (payroll.status === 'paid') watermark(doc, 'Paid');

    docTitle(doc, 'Salary Slip', `Pay Period: ${period}  |  Generated: ${fmtDate(new Date())}`);


    const bx = doc.y;
    const bw = (W - 12) / 3;
    infoBox(doc, 'Employee Name', `${payroll.teacher?.firstName || ''} ${payroll.teacher?.lastName || ''}`.trim(), LEFT, bx, bw);
    infoBox(doc, 'Employee Code', payroll.teacher?.employeeCode || '', LEFT + bw + 6, bx, bw);
    infoBox(doc, 'Pay Period', period, LEFT + (bw + 6) * 2, bx, bw);

    const bx2 = bx + 42;
    infoBox(doc, 'Payment Status', (payroll.status || '').toUpperCase(), LEFT, bx2, bw);
    if (payroll.paidAt) {
      infoBox(doc, 'Paid On', fmtDate(payroll.paidAt), LEFT + bw + 6, bx2, bw);
    }

    doc.y = bx2 + 50;

    const compCol = { x: LEFT + 14, w: W - 140, label: 'Salary Component' };
    const amtCol = { x: LEFT + 14, w: W - 28, label: 'Amount', align: 'right' };
    let y = tableHeader(doc, [compCol, amtCol], doc.y);

    y = tableDataRow(doc, [
      { text: 'Basic Salary', x: LEFT + 14, w: W - 140 },
      { text: rupees(payroll.basicSalary), x: LEFT + 14, w: W - 28, align: 'right' }
    ], y, { striped: true });

    y = tableDataRow(doc, [
      { text: 'Allowances (HRA, DA, etc.)', x: LEFT + 14, w: W - 140 },
      { text: `+ ${rupees(payroll.allowances)}`, x: LEFT + 14, w: W - 28, align: 'right' }
    ], y, { color: C.GREEN });

    y = tableDataRow(doc, [
      { text: 'Deductions (PF, TDS, etc.)', x: LEFT + 14, w: W - 140 },
      { text: `- ${rupees(payroll.deductions)}`, x: LEFT + 14, w: W - 28, align: 'right' }
    ], y, { color: C.RED, striped: true });

    y = totalBand(doc, 'NET SALARY PAYABLE', rupees(payroll.netSalary), y + 4);
    y += 8;

    statusPill(doc, payroll.status, RIGHT - 90, y);

    y += 60;
    doc.y = y;

    doc.rect(LEFT, y, W / 2 - 20, 0.5).fill(C.MUTED);
    doc.rect(MID + 20, y, W / 2 - 20, 0.5).fill(C.MUTED);

    doc.fontSize(8).fillColor(C.MUTED)
      .text('Employee Signature', LEFT, y + 6, { width: W / 2 - 20, align: 'center' })
      .text('Authorized Signatory', MID + 20, y + 6, { width: W / 2 - 20, align: 'center' });

    footerBlock(doc);
  });
};

const REPORT_TITLES = {
  'route-wise': 'Route-wise Bus Students',
  'stop-wise': 'Stop-wise Bus Students',
  'fee-collection': 'Bus Fee Collection Report',
  active: 'Active Bus Students',
  inactive: 'Inactive Bus Students'
};

exports.transportReportPdf = function transportReportPdf(res, reportType, rows) {
  const title = REPORT_TITLES[reportType] || 'Transport Report';
  const headers = reportType === 'fee-collection'
    ? ['Student', 'Month', 'Bus Fee', 'Paid', 'Receipt', 'Date']
    : ['Student', 'Class', 'Route', 'Stop', 'Fee', 'Status'];
  const colW = W / headers.length;

  pipePdf(res, `transport-${reportType}.pdf`, (doc) => {
    headerBlock(doc);
    docTitle(doc, title, `Generated on ${fmtDate(new Date())}`);

    const headerCols = headers.map((label, index) => ({
      x: LEFT + 8 + index * colW,
      w: colW - 8,
      label
    }));
    let y = tableHeader(doc, headerCols, doc.y);

    for (const row of rows) {
      const cells = reportType === 'fee-collection'
        ? [
            row.studentName || '—',
            row.feeMonth || '—',
            rupees(row.busFee),
            rupees(row.paidAmount),
            row.receiptNumber || '—',
            fmtDate(row.paymentDate)
          ]
        : [
            row.studentName || '—',
            row.className || '—',
            row.routeName || '—',
            row.stopName || '—',
            rupees(row.monthlyFee),
            row.busService && row.status === 'active' ? 'Active' : 'Inactive'
          ];
      y = tableDataRow(
        doc,
        cells.map((text, index) => ({ text: String(text), x: LEFT + 8 + index * colW, w: colW - 8 })),
        y,
        { striped: true }
      );
      if (y > PAGE_H - 80) {
        doc.addPage();
        y = M + 20;
      }
    }

    footerBlock(doc);
  });
};

const ATTENDANCE_REPORT_TITLES = {
  daily: 'Daily Attendance Report',
  monthly: 'Monthly Attendance Report',
  'student-summary': 'Student Attendance Summary',
  'class-summary': 'Class Attendance Summary'
};

exports.attendanceReportPdf = function attendanceReportPdf(res, reportType, rows) {
  const title = ATTENDANCE_REPORT_TITLES[reportType] || 'Attendance Report';
  const headers = reportType === 'daily'
    ? ['Date', 'Student', 'Class', 'Status', 'Remarks']
    : reportType === 'monthly' || reportType === 'student-summary'
      ? ['Student', 'Class', 'Month', 'Present', 'Absent', 'Leave', '%']
      : ['Class', 'Students', 'Present', 'Absent', 'Leave', '%'];
  const colW = W / headers.length;

  pipePdf(res, `attendance-${reportType}.pdf`, (doc) => {
    headerBlock(doc);
    docTitle(doc, title, `Generated on ${fmtDate(new Date())}`);

    const headerCols = headers.map((label, index) => ({
      x: LEFT + 8 + index * colW,
      w: colW - 8,
      label
    }));
    let y = tableHeader(doc, headerCols, doc.y);

    for (const row of rows) {
      let cells = [];
      if (reportType === 'daily') {
        cells = [fmtDate(row.date), row.studentName || '—', row.className || '—', row.status || '—', row.remarks || '—'];
      } else if (reportType === 'class-summary') {
        cells = [row.className || '—', String(row.studentCount || 0), String(row.present || 0), String(row.absent || 0), String(row.leave || 0), `${row.percentage || 0}%`];
      } else {
        cells = [row.studentName || '—', row.className || '—', row.month || '—', String(row.present || 0), String(row.absent || 0), String(row.leave || 0), `${row.percentage || 0}%`];
      }
      y = tableDataRow(
        doc,
        cells.map((text, index) => ({ text: String(text), x: LEFT + 8 + index * colW, w: colW - 8 })),
        y,
        { striped: true }
      );
      if (y > PAGE_H - 80) {
        doc.addPage();
        y = M + 20;
      }
    }

    footerBlock(doc);
  });
};

const MODULE_REPORT_CONFIG = {
  students: {
    register: {
      title: 'Student Register',
      headers: ['Adm No', 'Name', 'Class', 'Section', 'Status', 'Admission Date'],
      map: (row) => [row.admissionNumber, row.studentName, row.className, row.section, row.status, fmtDate(row.admissionDate)]
    },
    'admission-register': {
      title: 'Admission Register',
      headers: ['Adm No', 'Name', 'Class', 'Admission Date', 'Status'],
      map: (row) => [row.admissionNumber, row.studentName, row.classSection, fmtDate(row.admissionDate), row.status]
    },
    'class-wise': {
      title: 'Class-wise Student Report',
      headers: ['Class', 'Total', 'Active', 'Inactive'],
      map: (row) => [row.className, String(row.totalStudents), String(row.activeStudents), String(row.inactiveStudents)]
    },
    'section-wise': {
      title: 'Section-wise Student Report',
      headers: ['Class-Section', 'Total', 'Active'],
      map: (row) => [row.classSection, String(row.totalStudents), String(row.activeStudents)]
    },
    status: {
      title: 'Student Status Report',
      headers: ['Status', 'Total Students'],
      map: (row) => [row.status, String(row.totalStudents)]
    }
  },
  fees: {
    'monthly-collection': {
      title: 'Monthly Fee Collection Report',
      headers: ['Student', 'Class', 'Month', 'Paid', 'Receipt', 'Status'],
      map: (row) => [row.studentName, row.className, row.feeMonth, rupees(row.paidAmount), row.receiptNumber || '—', row.status]
    },
    pending: {
      title: 'Pending Fee Report',
      headers: ['Student', 'Class', 'Month', 'Due', 'Pending', 'Status'],
      map: (row) => [row.studentName, row.className, row.feeMonth, fmtDate(row.dueDate), rupees(row.pendingAmount), row.status]
    },
    'student-ledger': {
      title: 'Student Fee Ledger',
      headers: ['Date', 'Student', 'Type', 'Description', 'Debit', 'Credit'],
      map: (row) => [fmtDate(row.date), row.studentName, row.entryType, row.description, rupees(row.debit), rupees(row.credit)]
    },
    'bus-fee-collection': {
      title: 'Bus Fee Collection Report',
      headers: ['Student', 'Month', 'Bus Fee', 'Paid', 'Receipt', 'Date'],
      map: (row) => [row.studentName, row.feeMonth, rupees(row.busFee), rupees(row.paidAmount), row.receiptNumber || '—', fmtDate(row.paymentDate)]
    }
  },
  payroll: {
    summary: {
      title: 'Payroll Summary',
      headers: ['Month', 'Employees', 'Paid', 'Pending', 'Net Total'],
      map: (row) => [row.payrollMonth, String(row.employeeCount), String(row.paidCount), String(row.pendingCount), rupees(row.totalNet)]
    },
    'salary-summary': {
      title: 'Salary Summary',
      headers: ['Employee', 'Designation', 'Basic', 'Allowances', 'Deductions', 'Net', 'Status'],
      map: (row) => [row.teacherName, row.designation, rupees(row.basicSalary), rupees(row.allowances), rupees(row.deductions), rupees(row.netSalary), row.status]
    },
    'payment-status': {
      title: 'Payroll Payment Status',
      headers: ['Employee', 'Month', 'Net Salary', 'Status', 'Paid On'],
      map: (row) => [row.teacherName, row.payrollMonth, rupees(row.netSalary), row.status, fmtDate(row.paidAt)]
    }
  },
  transport: {
    'bus-strength': {
      title: 'Bus Strength Report',
      headers: ['Route', 'Vehicle', 'Capacity', 'Students', 'Available', 'Occupancy'],
      map: (row) => [row.routeName, row.vehicleNumber, String(row.capacity), String(row.activeStudents), String(row.availableSeats), `${row.occupancy}%`]
    }
  }
};

function genericTablePdf(res, filename, title, headers, rows, mapRow) {
  const colW = W / headers.length;
  pipePdf(res, filename, (doc) => {
    headerBlock(doc);
    docTitle(doc, title, `Generated on ${fmtDate(new Date())}`);
    const headerCols = headers.map((label, index) => ({
      x: LEFT + 8 + index * colW,
      w: colW - 8,
      label
    }));
    let y = tableHeader(doc, headerCols, doc.y);
    for (const row of rows) {
      const cells = mapRow(row);
      y = tableDataRow(
        doc,
        cells.map((text, index) => ({ text: String(text), x: LEFT + 8 + index * colW, w: colW - 8 })),
        y,
        { striped: true }
      );
      if (y > PAGE_H - 80) {
        doc.addPage();
        y = M + 20;
      }
    }
    footerBlock(doc);
  });
}

exports.moduleReportPdf = function moduleReportPdf(res, domain, reportType, rows) {
  if (domain === 'attendance') {
    return exports.attendanceReportPdf(res, reportType, rows);
  }
  if (domain === 'transport' && reportType !== 'bus-strength') {
    return exports.transportReportPdf(res, reportType, rows);
  }

  const config = MODULE_REPORT_CONFIG[domain]?.[reportType];
  if (!config) {
    return genericTablePdf(res, `${domain}-${reportType}.pdf`, `${domain} ${reportType}`, ['Data'], rows, (row) => [JSON.stringify(row)]);
  }
  return genericTablePdf(res, `${domain}-${reportType}.pdf`, config.title, config.headers, rows, config.map);
};
