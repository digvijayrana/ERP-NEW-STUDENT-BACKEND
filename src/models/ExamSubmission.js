const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    answer: { type: String, default: '' },
    isCorrect: Boolean,
    marksAwarded: { type: Number, default: 0 }
  },
  { _id: false }
);

const examSubmissionSchema = new mongoose.Schema(
  {
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    answers: [answerSchema],
    score: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    grade: String,
    status: { type: String, enum: ['in_progress', 'submitted', 'graded'], default: 'in_progress' },
    startedAt: { type: Date, default: Date.now },
    submittedAt: Date,
    gradedBy: { type: String, enum: ['auto', 'teacher'], default: 'auto' },
    teacherRemarks: String
  },
  { timestamps: true }
);

examSubmissionSchema.index({ exam: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('ExamSubmission', examSubmissionSchema);
