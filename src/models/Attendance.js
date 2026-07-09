const mongoose = require('mongoose');

const ATTENDANCE_STATUSES = ['present', 'absent', 'leave', 'holiday', 'late', 'half_day'];

const attendanceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    register: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceRegister' },
    date: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    remarks: String
  },
  { timestamps: true }
);

attendanceSchema.index({ student: 1, date: 1 }, { unique: true });
attendanceSchema.index({ register: 1 });
attendanceSchema.index({ academicYear: 1, classRoom: 1, date: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
module.exports.ATTENDANCE_STATUSES = ATTENDANCE_STATUSES;
