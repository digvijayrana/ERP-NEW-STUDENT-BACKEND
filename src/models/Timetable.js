const mongoose = require('mongoose');

const timetableSchema = new mongoose.Schema(
  {
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    dayOfWeek: { type: String, enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], required: true },
    periods: [
      {
        startTime: { type: String, required: true },
        endTime: { type: String, required: true },
        subject: { type: String, required: true },
        teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
        room: String
      }
    ]
  },
  { timestamps: true }
);

timetableSchema.index({ classRoom: 1, academicYear: 1, dayOfWeek: 1 }, { unique: true });

module.exports = mongoose.model('Timetable', timetableSchema);
