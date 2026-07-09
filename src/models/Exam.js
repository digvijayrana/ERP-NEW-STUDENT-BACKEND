const mongoose = require('mongoose');
const { softDeleteFieldSchema, applySoftDeleteMiddleware } = require('../utils/softDeleteFields');

const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    type: { type: String, enum: ['mcq', 'true_false', 'short_answer'], default: 'mcq' },
    options: [String],
    correctAnswer: { type: String, required: true },
    marks: { type: Number, default: 1, min: 1 },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    chapter: String,
    explanation: String
  },
  { _id: true }
);

const examSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    chapter: { type: String, required: true, trim: true },
    bookReference: { type: String, trim: true },
    additionalContext: { type: String, trim: true },
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'mixed'], default: 'medium' },
    status: { type: String, enum: ['draft', 'published', 'closed'], default: 'draft' },
    durationMinutes: { type: Number, default: 60, min: 5 },
    totalMarks: { type: Number, default: 0 },
    questions: [questionSchema],
    scheduledAt: Date,
    closesAt: Date,
    aiGenerated: { type: Boolean, default: false },
    questionCount: { type: Number, default: 10 },
    ...softDeleteFieldSchema
  },
  { timestamps: true }
);

applySoftDeleteMiddleware(examSchema);

examSchema.index({ classRoom: 1, academicYear: 1, status: 1, createdAt: -1 });
examSchema.index({ status: 1, createdAt: -1 });
examSchema.index({ title: 1, subject: 1 });

examSchema.pre('save', function preSave() {
  this.totalMarks = this.questions.reduce((sum, q) => sum + (q.marks || 1), 0);
});

module.exports = mongoose.model('Exam', examSchema);
