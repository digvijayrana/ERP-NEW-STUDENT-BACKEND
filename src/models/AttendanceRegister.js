const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');

const attendanceRegisterSchema = new mongoose.Schema(
  {
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    date: { type: Date, required: true },
    workflowStatus: { type: String, enum: ['draft', 'submitted', 'locked'], default: 'draft' },
    submittedAt: Date,
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lockedAt: Date,
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    unlockedAt: Date,
    unlockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    ...auditFieldSchema
  },
  { timestamps: true }
);

attendanceRegisterSchema.index({ academicYear: 1, classRoom: 1, date: 1 }, { unique: true });
attendanceRegisterSchema.index({ workflowStatus: 1, date: -1 });

module.exports = mongoose.model('AttendanceRegister', attendanceRegisterSchema);
