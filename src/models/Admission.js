const mongoose = require('mongoose');

const admissionSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    admissionType: { type: String, enum: ['new', 'transfer'], default: 'new' },
    previousSchool: String,
    notes: String,
    status: { type: String, enum: ['draft', 'confirmed', 'cancelled'], default: 'confirmed' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Admission', admissionSchema);
