const mongoose = require('mongoose');

const feeItemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    paidAt: { type: Date, default: Date.now },
    mode: { type: String, enum: ['cash', 'upi', 'card', 'bank_transfer', 'cheque'], default: 'cash' },
    referenceNumber: String,
    remarks: String
  },
  { _id: true }
);

const feeInvoiceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    invoiceNumber: { type: String, required: true, unique: true },
    dueDate: { type: Date, required: true },
    items: [feeItemSchema],
    discount: { type: Number, default: 0, min: 0 },
    fine: { type: Number, default: 0, min: 0 },
    payments: [paymentSchema],
    status: { type: String, enum: ['unpaid', 'partial', 'paid', 'cancelled'], default: 'unpaid' }
  },
  { timestamps: true }
);

feeInvoiceSchema.virtual('totalAmount').get(function totalAmount() {
  return this.items.reduce((sum, item) => sum + item.amount, 0) + this.fine - this.discount;
});

feeInvoiceSchema.virtual('paidAmount').get(function paidAmount() {
  return this.payments.reduce((sum, payment) => sum + payment.amount, 0);
});

feeInvoiceSchema.virtual('balanceAmount').get(function balanceAmount() {
  return Math.max(this.totalAmount - this.paidAmount, 0);
});

feeInvoiceSchema.pre('save', function setStatus(next) {
  if (this.status === 'cancelled') return next();
  const balance = this.balanceAmount;
  if (balance <= 0) this.status = 'paid';
  else if (this.paidAmount > 0) this.status = 'partial';
  else this.status = 'unpaid';
  next();
});

feeInvoiceSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('FeeInvoice', feeInvoiceSchema);
