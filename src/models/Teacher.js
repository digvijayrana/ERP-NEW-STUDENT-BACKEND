const mongoose = require('mongoose');

const teacherSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true, unique: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'Phone number must be exactly 10 digits']
    },
    email: { type: String, trim: true, lowercase: true },
    qualification: { type: String, trim: true },
    joiningDate: { type: Date, default: Date.now },
    baseSalary: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String
    }
  },
  { timestamps: true }
);

teacherSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

teacherSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Teacher', teacherSchema);
