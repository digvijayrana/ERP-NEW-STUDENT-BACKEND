const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');

const academicYearSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'active', 'closed'], default: 'draft' },
    closedAt: Date,
    ...auditFieldSchema
  },
  { timestamps: true }
);

academicYearSchema.pre('save', function syncActiveFlag() {
  this.isActive = this.status === 'active';
});

module.exports = mongoose.model('AcademicYear', academicYearSchema);
