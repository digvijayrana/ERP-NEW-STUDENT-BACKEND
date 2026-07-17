const mongoose = require('mongoose');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const periodSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    label: { type: String, required: true, trim: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    type: { type: String, enum: ['teaching', 'break', 'assembly'], default: 'teaching' }
  },
  { _id: false }
);

const facilitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['classroom', 'lab', 'sports', 'library'],
      required: true
    },
    capacity: { type: Number, default: 40, min: 1 },
    availableDays: [{ type: String, enum: DAYS }],
    unavailablePeriods: [{ type: Number }]
  },
  { _id: true }
);

const teacherAvailabilitySchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    dayOfWeek: { type: String, enum: DAYS, required: true },
    unavailablePeriods: [{ type: Number }]
  },
  { _id: false }
);

const classroomAvailabilitySchema = new mongoose.Schema(
  {
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    dayOfWeek: { type: String, enum: DAYS, required: true },
    unavailablePeriods: [{ type: Number }]
  },
  { _id: false }
);

const slotSchema = new mongoose.Schema(
  {
    classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom', required: true },
    dayOfWeek: { type: String, enum: DAYS, required: true },
    periodIndex: { type: Number, required: true },
    subject: { type: String, default: '' },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    facility: { type: mongoose.Schema.Types.ObjectId },
    room: { type: String, default: '' },
    slotType: {
      type: String,
      enum: ['subject', 'lab', 'sports', 'library', 'break', 'free'],
      default: 'subject'
    },
    locked: { type: Boolean, default: false }
  },
  { _id: true }
);

const conflictSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['teacher', 'room', 'facility', 'availability', 'break', 'unplaced'],
      required: true
    },
    severity: { type: String, enum: ['error', 'warning'], default: 'error' },
    message: { type: String, required: true },
    slotIds: [{ type: mongoose.Schema.Types.ObjectId }],
    dayOfWeek: String,
    periodIndex: Number
  },
  { _id: false }
);

const timetablePlanSchema = new mongoose.Schema(
  {
    academicYear: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    name: { type: String, default: 'AI Timetable Plan', trim: true },
    status: { type: String, enum: ['draft', 'applied'], default: 'draft' },
    workingDays: {
      type: [{ type: String, enum: DAYS }],
      default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    },
    periods: { type: [periodSchema], default: [] },
    facilities: { type: [facilitySchema], default: [] },
    teacherAvailability: { type: [teacherAvailabilitySchema], default: [] },
    classroomAvailability: { type: [classroomAvailabilitySchema], default: [] },
    constraints: {
      maxPeriodsPerTeacherPerDay: { type: Number, default: 6, min: 1, max: 12 },
      sportsPeriodsPerWeek: { type: Number, default: 2, min: 0, max: 6 },
      libraryPeriodsPerWeek: { type: Number, default: 1, min: 0, max: 6 },
      defaultSubjectPeriodsPerWeek: { type: Number, default: 4, min: 1, max: 10 },
      labPeriodsPerWeek: { type: Number, default: 2, min: 0, max: 6 },
      protectBreaks: { type: Boolean, default: true }
    },
    slots: { type: [slotSchema], default: [] },
    conflicts: { type: [conflictSchema], default: [] },
    unplaced: [
      {
        classRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom' },
        subject: String,
        teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
        slotType: String,
        reason: String
      }
    ],
    stats: {
      placed: { type: Number, default: 0 },
      unplaced: { type: Number, default: 0 },
      conflictCount: { type: Number, default: 0 },
      teachingSlots: { type: Number, default: 0 },
      score: { type: Number, default: 0 }
    },
    generatedAt: Date,
    appliedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

timetablePlanSchema.index({ academicYear: 1, status: 1 });

module.exports = mongoose.model('TimetablePlan', timetablePlanSchema);
module.exports.DAYS = DAYS;
