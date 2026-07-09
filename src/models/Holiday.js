const mongoose = require('mongoose');
const { softDeleteFieldSchema, applySoftDeleteMiddleware } = require('../utils/softDeleteFields');

const holidaySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ...softDeleteFieldSchema
  },
  { timestamps: true }
);

applySoftDeleteMiddleware(holidaySchema);

holidaySchema.index({ date: 1 }, { unique: true });

module.exports = mongoose.model('Holiday', holidaySchema);
