const PDFDocument = require('pdfkit');

const C = {
  NAVY: '#0d1b4a',
  ROYAL: '#1b3a8c',
  BLUE: '#2563eb',
  SKY: '#3b82f6',
  LIGHT_BLUE: '#dbeafe',
  ICE: '#eff6ff',
  GOLD: '#d4a017',
  GOLD_LIGHT: '#fef9c3',
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
  const steps = 20;
  const stepW = W / steps;
  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const r = Math.round(13 + ratio * (27 - 13));
    const g = Math.round(27 + ratio * (58 - 27));
    const b = Math.round(74 + ratio * (140 - 74));
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

  doc.fontSize(9).fillColor('#93c5fd').font('Helvetica')
    .text(s.address, LEFT + 20, topY + 46, { width: W - 100 });

  const contact = [s.phone, s.email, s.website].filter(Boolean);
  if (contact.length) {
    doc.fontSize(8).fillColor('#93c5fd')
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

    invoice.items.forEach((item, i) => {
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
