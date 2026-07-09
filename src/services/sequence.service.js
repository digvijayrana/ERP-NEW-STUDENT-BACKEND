const Counter = require('../models/Counter');

async function nextSequence(name, prefix, padding = 4) {
  const counter = await Counter.findByIdAndUpdate(
    name,
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return `${prefix}${String(counter.sequence).padStart(padding, '0')}`;
}

exports.nextAdmissionNumber = function nextAdmissionNumber() {
  const year = new Date().getFullYear();
  return nextSequence(`admission-${year}`, `ADM-${year}-`, 4);
};

exports.nextInvoiceNumber = function nextInvoiceNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return nextSequence(`invoice-${stamp}`, `INV-${stamp}-`, 5);
};

exports.nextReceiptNumber = function nextReceiptNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return nextSequence(`receipt-${stamp}`, `RCP-${stamp}-`, 5);
};
