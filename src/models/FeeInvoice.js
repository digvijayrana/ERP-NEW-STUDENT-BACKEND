const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');

const feeItemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    receiptNumber: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    paidAt: { type: Date, default: Date.now },
    mode: { type: String, enum: ['cash', 'upi', 'card', 'bank_transfer', 'cheque'], default: 'cash' },
    referenceNumber: String,
    remarks: String,
    status: { type: String, enum: ['active', 'void'], default: 'active' },
    locked: { type: Boolean, default: true },
    tuitionPaid: { type: Number, default: 0, min: 0 },
    busPaid: { type: Number, default: 0, min: 0 },
    otherPaid: { type: Number, default: 0, min: 0 },
    discountApplied: { type: Number, default: 0, min: 0 },
    fineApplied: { type: Number, default: 0, min: 0 }
  },
  { _id: true }
);

const feeInvoiceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    invoiceNumber: { type: String, required: true, unique: true },
    feeMonth: { type: Number, min: 1, max: 12, required: true },
    feeYear: { type: Number, required: true },
    billingCycle: { type: String, enum: ['monthly', 'quarterly', 'half_yearly', 'yearly'], default: 'monthly' },
    dueDate: { type: Date, required: true },
    tuitionFee: { type: Number, default: 0, min: 0 },
    busFee: { type: Number, default: 0, min: 0 },
    otherCharges: { type: Number, default: 0, min: 0 },
    previousPending: { type: Number, default: 0, min: 0 },
    items: [feeItemSchema],
    // Detailed fee-structure breakdown (admission, registration, tuition, bus, lab, custom).
    feeComponents: [
      new mongoose.Schema(
        { key: String, label: String, amount: { type: Number, default: 0, min: 0 } },
        { _id: false }
      )
    ],
    discount: { type: Number, default: 0, min: 0 },
    fine: { type: Number, default: 0, min: 0 },
    payments: [paymentSchema],
    status: { type: String, enum: ['unpaid', 'partial', 'paid', 'cancelled'], default: 'unpaid' },
    locked: { type: Boolean, default: false },
    ...auditFieldSchema
  },
  { timestamps: true }
);

feeInvoiceSchema.index(
  { student: 1, academicYear: 1, feeMonth: 1, feeYear: 1 },
  { unique: true, partialFilterExpression: { status: { $ne: 'cancelled' } } }
);
feeInvoiceSchema.index({ status: 1, feeYear: -1, feeMonth: -1 });
feeInvoiceSchema.index({ academicYear: 1, classRoom: 1, status: 1 });
feeInvoiceSchema.index({ 'payments.receiptNumber': 1 });
feeInvoiceSchema.index({ invoiceNumber: 1 });

feeInvoiceSchema.virtual('totalAmount').get(function totalAmount() {
  if (this.tuitionFee || this.busFee || this.otherCharges || this.previousPending) {
    return (
      (this.tuitionFee || 0) +
      (this.busFee || 0) +
      (this.otherCharges || 0) +
      (this.previousPending || 0) +
      (this.fine || 0) -
      (this.discount || 0)
    );
  }
  return this.items.reduce((sum, item) => sum + item.amount, 0) + (this.fine || 0) - (this.discount || 0);
});

feeInvoiceSchema.virtual('paidAmount').get(function paidAmount() {
  return this.payments
    .filter((payment) => payment.status !== 'void')
    .reduce((sum, payment) => sum + payment.amount, 0);
});

feeInvoiceSchema.virtual('balanceAmount').get(function balanceAmount() {
  return Math.max(this.totalAmount - this.paidAmount, 0);
});

function syncItemsFromComponents(doc) {
  // Prefer the detailed fee-structure breakdown when present so line items
  // (Admission Fee, Lab Fee, etc.) survive on the invoice, PDF and detail view.
  if (Array.isArray(doc.feeComponents) && doc.feeComponents.length) {
    const detailed = doc.feeComponents
      .filter((component) => component.amount > 0)
      .map((component) => ({ label: component.label, amount: component.amount }));
    if (doc.previousPending > 0) detailed.push({ label: 'Previous Pending', amount: doc.previousPending });

    // Guarantee Bus Fee appears whenever the invoice carries busFee, even if it
    // was omitted from feeComponents (legacy invoices / older demand logic).
    const hasBus = detailed.some((item) => /bus\s*fee/i.test(String(item.label || '')));
    if (!hasBus && Number(doc.busFee) > 0) {
      const tuitionIdx = detailed.findIndex((item) => /tuition/i.test(String(item.label || '')));
      const busLine = { label: 'Bus Fee', amount: doc.busFee };
      if (tuitionIdx >= 0) detailed.splice(tuitionIdx + 1, 0, busLine);
      else detailed.push(busLine);
    }

    if (detailed.length) doc.items = detailed;
    return;
  }

  const items = [];
  if (doc.tuitionFee > 0) items.push({ label: 'Tuition Fee', amount: doc.tuitionFee });
  if (doc.busFee > 0) items.push({ label: 'Bus Fee', amount: doc.busFee });
  if (doc.otherCharges > 0) items.push({ label: 'Other Charges', amount: doc.otherCharges });
  if (doc.previousPending > 0) items.push({ label: 'Previous Pending', amount: doc.previousPending });
  if (items.length) doc.items = items;
}

feeInvoiceSchema.pre('save', function setStatus(next) {
  if (!this.feeMonth && this.dueDate) {
    const due = new Date(this.dueDate);
    this.feeMonth = due.getMonth() + 1;
    this.feeYear = due.getFullYear();
  }

  if (!this.tuitionFee && this.items?.length) {
    const tuition = this.items.find((item) => /tuition/i.test(item.label));
    this.tuitionFee = tuition?.amount || this.items[0]?.amount || 0;
  }

  syncItemsFromComponents(this);

  if (this.status === 'cancelled') return next();

  const balance = this.balanceAmount;
  if (balance <= 0 && this.paidAmount > 0) {
    this.status = 'paid';
    this.locked = true;
  } else if (this.paidAmount > 0) {
    this.status = 'partial';
  } else {
    this.status = 'unpaid';
  }
  next();
});

feeInvoiceSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('FeeInvoice', feeInvoiceSchema);
