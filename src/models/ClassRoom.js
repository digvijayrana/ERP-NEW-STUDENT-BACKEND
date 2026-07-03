const mongoose = require('mongoose');

const classRoomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    section: { type: String, required: true, trim: true },
    capacity: { type: Number, default: 40 },
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    classTeacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    subjects: [
      {
        name: { type: String, required: true },
        teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' }
      }
    ],
    monthlyFee: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

classRoomSchema.index({ name: 1, section: 1, academicYear: 1 }, { unique: true });
classRoomSchema.index(
  { classTeacher: 1 },
  {
    unique: true,
    partialFilterExpression: { classTeacher: { $exists: true, $type: 'objectId' } }
  }
);

module.exports = mongoose.model('ClassRoom', classRoomSchema);
