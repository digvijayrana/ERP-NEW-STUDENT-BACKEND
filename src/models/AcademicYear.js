const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');
const { softDeleteFieldSchema, applySoftDeleteMiddleware } = require('../utils/softDeleteFields');

const academicYearSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'active', 'closed'], default: 'draft' },
    closedAt: Date,
    archivedAt: Date,
    ...softDeleteFieldSchema,
    ...auditFieldSchema
  },
  { timestamps: true }
);

applySoftDeleteMiddleware(academicYearSchema);

academicYearSchema.pre('save', function syncActiveFlag() {
  this.isActive = this.status === 'active';
});

module.exports = mongoose.model('AcademicYear', academicYearSchema);
