/**
 * AI Timetable Generator — constraint-based scheduler.
 *
 * Constraints enforced:
 *  - Teacher availability
 *  - Classroom availability
 *  - Lab / Sports / Library facility availability
 *  - Break time (non-teaching periods)
 *  - No teacher double-booking
 *  - No room / facility double-booking
 */
const ClassRoom = require('../models/ClassRoom');
const Teacher = require('../models/Teacher');
const AcademicYear = require('../models/AcademicYear');
const Timetable = require('../models/Timetable');
const TimetablePlan = require('../models/TimetablePlan');
const { DAYS } = TimetablePlan;
const { createLogger } = require('../utils/logger');

const log = createLogger('timetable-generator');

const DEFAULT_PERIODS = [
  { index: 1, label: 'Period 1', startTime: '08:00', endTime: '08:40', type: 'teaching' },
  { index: 2, label: 'Period 2', startTime: '08:40', endTime: '09:20', type: 'teaching' },
  { index: 3, label: 'Period 3', startTime: '09:20', endTime: '10:00', type: 'teaching' },
  { index: 4, label: 'Short Break', startTime: '10:00', endTime: '10:20', type: 'break' },
  { index: 5, label: 'Period 4', startTime: '10:20', endTime: '11:00', type: 'teaching' },
  { index: 6, label: 'Period 5', startTime: '11:00', endTime: '11:40', type: 'teaching' },
  { index: 7, label: 'Period 6', startTime: '11:40', endTime: '12:20', type: 'teaching' },
  { index: 8, label: 'Lunch Break', startTime: '12:20', endTime: '13:00', type: 'break' },
  { index: 9, label: 'Period 7', startTime: '13:00', endTime: '13:40', type: 'teaching' },
  { index: 10, label: 'Period 8', startTime: '13:40', endTime: '14:20', type: 'teaching' }
];

const DEFAULT_FACILITIES = [
  { name: 'Science Lab', type: 'lab', capacity: 40, availableDays: [...DAYS], unavailablePeriods: [] },
  { name: 'Computer Lab', type: 'lab', capacity: 40, availableDays: [...DAYS], unavailablePeriods: [] },
  { name: 'Sports Ground', type: 'sports', capacity: 120, availableDays: [...DAYS], unavailablePeriods: [] },
  { name: 'Library', type: 'library', capacity: 60, availableDays: [...DAYS], unavailablePeriods: [] }
];

function tid(value) {
  if (!value) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function classLabel(room) {
  if (!room) return '—';
  return `${room.name || ''}${room.section ? `-${room.section}` : ''}`.trim() || '—';
}

function teacherLabel(teacher) {
  if (!teacher) return '—';
  return [teacher.firstName, teacher.lastName].filter(Boolean).join(' ').trim() || teacher.employeeCode || '—';
}

function isLabSubject(name = '') {
  return /lab|practical|computer|science experiment/i.test(String(name));
}

function isSportsSubject(name = '') {
  return /sport|pe\b|physical education|games/i.test(String(name));
}

function isLibrarySubject(name = '') {
  return /library|reading|library period/i.test(String(name));
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function periodMap(plan) {
  return new Map((plan.periods || []).map((p) => [p.index, p]));
}

function teachingIndexes(plan) {
  return (plan.periods || []).filter((p) => p.type === 'teaching').map((p) => p.index);
}

function facilityById(plan, id) {
  return (plan.facilities || []).find((f) => String(f._id) === String(id));
}

function facilitiesOfType(plan, type) {
  return (plan.facilities || []).filter((f) => f.type === type);
}

function teacherUnavailable(plan, teacherId, day, periodIndex) {
  return (plan.teacherAvailability || []).some(
    (row) =>
      tid(row.teacher) === tid(teacherId) &&
      row.dayOfWeek === day &&
      (row.unavailablePeriods || []).includes(periodIndex)
  );
}

function classroomUnavailable(plan, classRoomId, day, periodIndex) {
  return (plan.classroomAvailability || []).some(
    (row) =>
      tid(row.classRoom) === tid(classRoomId) &&
      row.dayOfWeek === day &&
      (row.unavailablePeriods || []).includes(periodIndex)
  );
}

function facilityUnavailable(facility, day, periodIndex) {
  if (!facility) return true;
  if ((facility.availableDays || []).length && !facility.availableDays.includes(day)) return true;
  if ((facility.unavailablePeriods || []).includes(periodIndex)) return true;
  return false;
}

function slotKey(day, periodIndex) {
  return `${day}|${periodIndex}`;
}

/**
 * Detect all hard conflicts on the current plan slots.
 */
function detectConflicts(plan) {
  const conflicts = [];
  const periods = periodMap(plan);
  const byTeacher = new Map();
  const byFacility = new Map();
  const byClass = new Map();

  for (const slot of plan.slots || []) {
    const period = periods.get(slot.periodIndex);
    const sid = slot._id;

    if (period?.type === 'break' && slot.slotType !== 'break' && plan.constraints?.protectBreaks !== false) {
      conflicts.push({
        type: 'break',
        severity: 'error',
        message: `Teaching placed on break (${period.label}) for ${classLabel(slot.classRoom)}`,
        slotIds: sid ? [sid] : [],
        dayOfWeek: slot.dayOfWeek,
        periodIndex: slot.periodIndex
      });
    }

    if (slot.teacher && slot.slotType !== 'break' && slot.slotType !== 'free') {
      if (teacherUnavailable(plan, slot.teacher, slot.dayOfWeek, slot.periodIndex)) {
        conflicts.push({
          type: 'availability',
          severity: 'error',
          message: `Teacher unavailable: ${teacherLabel(slot.teacher)} on ${slot.dayOfWeek} P${slot.periodIndex}`,
          slotIds: sid ? [sid] : [],
          dayOfWeek: slot.dayOfWeek,
          periodIndex: slot.periodIndex
        });
      }
      const tk = `${tid(slot.teacher)}|${slotKey(slot.dayOfWeek, slot.periodIndex)}`;
      if (!byTeacher.has(tk)) byTeacher.set(tk, []);
      byTeacher.get(tk).push(slot);
    }

    if (classroomUnavailable(plan, slot.classRoom, slot.dayOfWeek, slot.periodIndex)) {
      conflicts.push({
        type: 'availability',
        severity: 'error',
        message: `Class unavailable: ${classLabel(slot.classRoom)} on ${slot.dayOfWeek} P${slot.periodIndex}`,
        slotIds: sid ? [sid] : [],
        dayOfWeek: slot.dayOfWeek,
        periodIndex: slot.periodIndex
      });
    }

    const ck = `${tid(slot.classRoom)}|${slotKey(slot.dayOfWeek, slot.periodIndex)}`;
    if (!byClass.has(ck)) byClass.set(ck, []);
    byClass.get(ck).push(slot);

    if (slot.facility && slot.slotType !== 'break' && slot.slotType !== 'free') {
      const facility = facilityById(plan, slot.facility);
      if (facilityUnavailable(facility, slot.dayOfWeek, slot.periodIndex)) {
        conflicts.push({
          type: 'availability',
          severity: 'error',
          message: `Facility unavailable: ${facility?.name || 'room'} on ${slot.dayOfWeek} P${slot.periodIndex}`,
          slotIds: sid ? [sid] : [],
          dayOfWeek: slot.dayOfWeek,
          periodIndex: slot.periodIndex
        });
      }
      const fk = `${tid(slot.facility)}|${slotKey(slot.dayOfWeek, slot.periodIndex)}`;
      if (!byFacility.has(fk)) byFacility.set(fk, []);
      byFacility.get(fk).push(slot);
    }
  }

  for (const [, group] of byTeacher) {
    if (group.length < 2) continue;
    conflicts.push({
      type: 'teacher',
      severity: 'error',
      message: `Teacher conflict: ${teacherLabel(group[0].teacher)} double-booked on ${group[0].dayOfWeek} P${group[0].periodIndex}`,
      slotIds: group.map((s) => s._id).filter(Boolean),
      dayOfWeek: group[0].dayOfWeek,
      periodIndex: group[0].periodIndex
    });
  }

  for (const [, group] of byFacility) {
    if (group.length < 2) continue;
    const facility = facilityById(plan, group[0].facility);
    conflicts.push({
      type: 'room',
      severity: 'error',
      message: `Room conflict: ${facility?.name || 'Facility'} double-booked on ${group[0].dayOfWeek} P${group[0].periodIndex}`,
      slotIds: group.map((s) => s._id).filter(Boolean),
      dayOfWeek: group[0].dayOfWeek,
      periodIndex: group[0].periodIndex
    });
  }

  for (const [, group] of byClass) {
    const teaching = group.filter((s) => s.slotType !== 'break' && s.slotType !== 'free');
    if (teaching.length < 2) continue;
    conflicts.push({
      type: 'room',
      severity: 'error',
      message: `Class double-booked: ${classLabel(group[0].classRoom)} on ${group[0].dayOfWeek} P${group[0].periodIndex}`,
      slotIds: teaching.map((s) => s._id).filter(Boolean),
      dayOfWeek: group[0].dayOfWeek,
      periodIndex: group[0].periodIndex
    });
  }

  // Max periods / teacher / day soft check
  const maxPerDay = plan.constraints?.maxPeriodsPerTeacherPerDay || 6;
  const teacherDayCount = new Map();
  for (const slot of plan.slots || []) {
    if (!slot.teacher || slot.slotType === 'break' || slot.slotType === 'free') continue;
    const key = `${tid(slot.teacher)}|${slot.dayOfWeek}`;
    teacherDayCount.set(key, (teacherDayCount.get(key) || 0) + 1);
  }
  for (const [key, count] of teacherDayCount) {
    if (count <= maxPerDay) continue;
    const [teacherId, day] = key.split('|');
    const sample = (plan.slots || []).find((s) => tid(s.teacher) === teacherId && s.dayOfWeek === day);
    conflicts.push({
      type: 'availability',
      severity: 'warning',
      message: `Teacher overload: ${teacherLabel(sample?.teacher)} has ${count} periods on ${day} (max ${maxPerDay})`,
      slotIds: [],
      dayOfWeek: day
    });
  }

  for (const row of plan.unplaced || []) {
    conflicts.push({
      type: 'unplaced',
      severity: 'warning',
      message: `Unplaced: ${row.subject || row.slotType} for ${classLabel(row.classRoom)} — ${row.reason || 'no free slot'}`,
      slotIds: []
    });
  }

  return conflicts;
}

function computeStats(plan) {
  const teachingSlots = (plan.slots || []).filter((s) => !['break', 'free'].includes(s.slotType)).length;
  const conflictCount = (plan.conflicts || []).filter((c) => c.severity === 'error').length;
  const unplaced = (plan.unplaced || []).length;
  const placed = teachingSlots;
  const demand = placed + unplaced;
  const score = demand ? Math.max(0, Math.round(((placed - conflictCount * 2) / demand) * 100)) : 0;
  return { placed, unplaced, conflictCount, teachingSlots, score };
}

function occupiedSets(slots, excludeSlotId = null) {
  const teachers = new Set();
  const facilities = new Set();
  const classes = new Set();
  const teacherDayLoad = new Map();

  for (const slot of slots) {
    if (excludeSlotId && slot._id && String(slot._id) === String(excludeSlotId)) continue;
    if (slot.slotType === 'break' || slot.slotType === 'free') continue;
    const k = slotKey(slot.dayOfWeek, slot.periodIndex);
    if (slot.teacher) {
      teachers.add(`${tid(slot.teacher)}|${k}`);
      const dk = `${tid(slot.teacher)}|${slot.dayOfWeek}`;
      teacherDayLoad.set(dk, (teacherDayLoad.get(dk) || 0) + 1);
    }
    if (slot.facility) facilities.add(`${tid(slot.facility)}|${k}`);
    classes.add(`${tid(slot.classRoom)}|${k}`);
  }
  return { teachers, facilities, classes, teacherDayLoad };
}

function pickFacility(plan, slotType, subject, homeName) {
  if (slotType === 'lab' || isLabSubject(subject)) {
    const labs = facilitiesOfType(plan, 'lab');
    if (/computer|ict|it\b/i.test(subject)) {
      const computer = labs.find((f) => /computer|ict/i.test(f.name));
      if (computer) return computer;
    }
    return labs[0] || null;
  }
  if (slotType === 'sports' || isSportsSubject(subject)) {
    return facilitiesOfType(plan, 'sports')[0] || null;
  }
  if (slotType === 'library' || isLibrarySubject(subject)) {
    return facilitiesOfType(plan, 'library')[0] || null;
  }
  // Prefer a classroom facility matching class name, else invent virtual room label
  const rooms = facilitiesOfType(plan, 'classroom');
  const match = rooms.find((f) => f.name === homeName);
  return match || null;
}

function canPlace(plan, occupied, { classRoomId, teacherId, facilityId, day, periodIndex, maxPerDay }) {
  const k = slotKey(day, periodIndex);
  if (occupied.classes.has(`${tid(classRoomId)}|${k}`)) return false;
  if (teacherId && occupied.teachers.has(`${tid(teacherId)}|${k}`)) return false;
  if (facilityId && occupied.facilities.has(`${tid(facilityId)}|${k}`)) return false;
  if (teacherUnavailable(plan, teacherId, day, periodIndex)) return false;
  if (classroomUnavailable(plan, classRoomId, day, periodIndex)) return false;
  const facility = facilityId ? facilityById(plan, facilityId) : null;
  if (facilityId && facilityUnavailable(facility, day, periodIndex)) return false;
  if (teacherId) {
    const load = occupied.teacherDayLoad.get(`${tid(teacherId)}|${day}`) || 0;
    if (load >= maxPerDay) return false;
  }
  return true;
}

function markOccupied(occupied, { classRoomId, teacherId, facilityId, day, periodIndex }) {
  const k = slotKey(day, periodIndex);
  occupied.classes.add(`${tid(classRoomId)}|${k}`);
  if (teacherId) {
    occupied.teachers.add(`${tid(teacherId)}|${k}`);
    const dk = `${tid(teacherId)}|${day}`;
    occupied.teacherDayLoad.set(dk, (occupied.teacherDayLoad.get(dk) || 0) + 1);
  }
  if (facilityId) occupied.facilities.add(`${tid(facilityId)}|${k}`);
}

function buildDemands(classRoom, plan) {
  const c = plan.constraints || {};
  const defaultPeriods = c.defaultSubjectPeriodsPerWeek || 4;
  const labPeriods = c.labPeriodsPerWeek || 2;
  const sportsCount = c.sportsPeriodsPerWeek || 2;
  const libraryCount = c.libraryPeriodsPerWeek || 1;
  const demands = [];
  const subjects = classRoom.subjects || [];

  let hasSports = false;
  let hasLibrary = false;

  for (const sub of subjects) {
    const name = sub.name || '';
    const teacher = sub.teacher;
    if (!teacher) continue;

    if (isSportsSubject(name)) {
      hasSports = true;
      for (let i = 0; i < sportsCount; i += 1) {
        demands.push({ subject: name, teacher, slotType: 'sports', classRoom });
      }
      continue;
    }
    if (isLibrarySubject(name)) {
      hasLibrary = true;
      for (let i = 0; i < libraryCount; i += 1) {
        demands.push({ subject: name, teacher, slotType: 'library', classRoom });
      }
      continue;
    }
    if (isLabSubject(name)) {
      for (let i = 0; i < labPeriods; i += 1) {
        demands.push({ subject: name, teacher, slotType: 'lab', classRoom });
      }
      continue;
    }
    for (let i = 0; i < defaultPeriods; i += 1) {
      demands.push({ subject: name, teacher, slotType: 'subject', classRoom });
    }
  }

  // Inject sports / library even if not listed on class subjects
  if (!hasSports && sportsCount > 0) {
    const peTeacher = subjects.find((s) => isSportsSubject(s.name))?.teacher || classRoom.classTeacher || subjects[0]?.teacher;
    if (peTeacher) {
      for (let i = 0; i < sportsCount; i += 1) {
        demands.push({ subject: 'Sports / PE', teacher: peTeacher, slotType: 'sports', classRoom });
      }
    }
  }
  if (!hasLibrary && libraryCount > 0) {
    const libTeacher = classRoom.classTeacher || subjects[0]?.teacher;
    if (libTeacher) {
      for (let i = 0; i < libraryCount; i += 1) {
        demands.push({ subject: 'Library', teacher: libTeacher, slotType: 'library', classRoom });
      }
    }
  }

  return demands;
}

async function resolveAcademicYear(academicYearId) {
  if (academicYearId) {
    const year = await AcademicYear.findById(academicYearId);
    if (year) return year;
  }
  return AcademicYear.findOne({ status: 'active' }).sort({ startDate: -1 });
}

async function ensureClassroomFacilities(plan, classes) {
  const existing = new Set((plan.facilities || []).map((f) => `${f.type}:${f.name}`));
  for (const room of classes) {
    const name = `Room ${classLabel(room)}`;
    const key = `classroom:${name}`;
    if (existing.has(key)) continue;
    plan.facilities.push({
      name,
      type: 'classroom',
      capacity: room.capacity || 40,
      availableDays: [...(plan.workingDays || DAYS)],
      unavailablePeriods: []
    });
    existing.add(key);
  }
}

/**
 * Get latest draft plan or create a blank one with defaults.
 */
async function getOrCreatePlan({ academicYear, userId } = {}) {
  const year = await resolveAcademicYear(academicYear);
  if (!year) throw Object.assign(new Error('No academic year found'), { status: 400 });

  const draft = await TimetablePlan.findOne({ academicYear: year._id, status: 'draft' }).sort({ updatedAt: -1 });
  const applied = await TimetablePlan.findOne({ academicYear: year._id, status: 'applied' }).sort({
    updatedAt: -1
  });

  // Prefer a draft that still has timetable data. An empty draft left behind after
  // publish must not hide the live applied plan on Refresh.
  const draftHasSlots = (draft?.slots || []).length > 0;
  const appliedHasSlots = (applied?.slots || []).length > 0;
  let plan = null;
  if (draft && draftHasSlots) {
    plan = draft;
  } else if (applied && appliedHasSlots) {
    plan = applied;
    if (draft && !draftHasSlots) {
      await TimetablePlan.deleteOne({ _id: draft._id });
    }
  } else if (draft) {
    plan = draft;
  } else if (applied) {
    plan = applied;
  }

  if (!plan) {
    plan = await TimetablePlan.create({
      academicYear: year._id,
      name: `School Timetable — ${year.name}`,
      status: 'draft',
      workingDays: [...DAYS],
      periods: DEFAULT_PERIODS,
      facilities: DEFAULT_FACILITIES.map((f) => ({ ...f, availableDays: [...DAYS] })),
      teacherAvailability: [],
      classroomAvailability: [],
      constraints: {},
      slots: [],
      conflicts: [],
      unplaced: [],
      stats: {},
      createdBy: userId || undefined
    });
  }

  return populatePlan(plan._id);
}

/**
 * Make an applied (live) plan editable again without clearing slots/teachers.
 */
async function reopenPlanForEdit(planId) {
  const plan = await TimetablePlan.findById(planId);
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });

  if (plan.status === 'draft') {
    return populatePlan(plan._id);
  }

  // Drop any empty leftover drafts for the same year so dashboard stays on this plan.
  await TimetablePlan.deleteMany({
    academicYear: plan.academicYear,
    status: 'draft',
    _id: { $ne: plan._id },
    $or: [{ slots: { $exists: false } }, { slots: { $size: 0 } }]
  });

  plan.status = 'draft';
  await plan.save();
  return populatePlan(plan._id);
}

/**
 * Clear period assignments for one class/section only (keeps bell schedule
 * and other classes). Used by the timetable Refresh action.
 */
async function resetPlan(planId, { classRoom } = {}) {
  const plan = await TimetablePlan.findById(planId);
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });
  if (!classRoom) {
    throw Object.assign(new Error('Select a class to refresh'), { status: 400 });
  }

  const classId = tid(classRoom);
  plan.status = 'draft';
  plan.slots = (plan.slots || []).filter((slot) => tid(slot.classRoom) !== classId);
  plan.unplaced = (plan.unplaced || []).filter((row) => tid(row.classRoom) !== classId);
  plan.conflicts = detectConflicts(plan);
  plan.stats = computeStats(plan);
  if (!(plan.slots || []).length) {
    plan.generatedAt = undefined;
  }
  await plan.save();
  return populatePlan(plan._id);
}

async function populatePlan(id) {
  return TimetablePlan.findById(id)
    .populate('academicYear', 'name status startDate endDate')
    .populate('slots.classRoom', 'name section')
    .populate('slots.teacher', 'firstName lastName employeeCode')
    .populate('unplaced.classRoom', 'name section')
    .populate('unplaced.teacher', 'firstName lastName employeeCode')
    .populate('teacherAvailability.teacher', 'firstName lastName employeeCode')
    .populate('classroomAvailability.classRoom', 'name section')
    .populate('createdBy', 'name email');
}

async function updatePlanConfig(planId, payload = {}) {
  const plan = await TimetablePlan.findById(planId);
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });
  if (plan.status === 'applied') {
    throw Object.assign(new Error('Applied plans are read-only. Generate a new draft to edit constraints.'), { status: 400 });
  }

  if (payload.name) plan.name = String(payload.name).trim();
  if (Array.isArray(payload.workingDays) && payload.workingDays.length) {
    plan.workingDays = payload.workingDays.filter((d) => DAYS.includes(d));
  }
  if (Array.isArray(payload.periods) && payload.periods.length) {
    const periods = payload.periods.map((p, i) => ({
      index: Number(p.index ?? i + 1),
      label: String(p.label || `Period ${i + 1}`).trim(),
      startTime: String(p.startTime || ''),
      endTime: String(p.endTime || ''),
      type: ['teaching', 'break', 'assembly'].includes(p.type) ? p.type : 'teaching'
    }));
    if (periods.some((p) => !p.startTime || !p.endTime || p.startTime >= p.endTime)) {
      throw Object.assign(new Error('Every period must have a valid start and end time'), { status: 400 });
    }
    const sorted = [...periods].sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (sorted.some((p, i) => i > 0 && p.startTime < sorted[i - 1].endTime)) {
      throw Object.assign(new Error('Period times cannot overlap'), { status: 400 });
    }
    plan.periods = sorted.map((period, index) => ({ ...period, index: index + 1 }));
    // Existing slot indexes no longer safely map to the edited bell schedule.
    plan.slots = [];
    plan.unplaced = [];
    plan.conflicts = [];
    plan.stats = { placed: 0, unplaced: 0, conflictCount: 0, teachingSlots: 0, score: 0 };
    plan.generatedAt = undefined;
  }
  if (Array.isArray(payload.facilities)) {
    plan.facilities = payload.facilities.map((f) => ({
      _id: f._id,
      name: f.name,
      type: f.type,
      capacity: f.capacity || 40,
      availableDays: Array.isArray(f.availableDays) && f.availableDays.length ? f.availableDays : [...DAYS],
      unavailablePeriods: Array.isArray(f.unavailablePeriods) ? f.unavailablePeriods : []
    }));
  }
  if (Array.isArray(payload.teacherAvailability)) {
    plan.teacherAvailability = payload.teacherAvailability.map((row) => ({
      teacher: tid(row.teacher),
      dayOfWeek: row.dayOfWeek,
      unavailablePeriods: Array.isArray(row.unavailablePeriods) ? row.unavailablePeriods.map(Number) : []
    }));
  }
  if (Array.isArray(payload.classroomAvailability)) {
    plan.classroomAvailability = payload.classroomAvailability.map((row) => ({
      classRoom: tid(row.classRoom),
      dayOfWeek: row.dayOfWeek,
      unavailablePeriods: Array.isArray(row.unavailablePeriods) ? row.unavailablePeriods.map(Number) : []
    }));
  }
  if (payload.constraints && typeof payload.constraints === 'object') {
    plan.constraints = { ...plan.constraints.toObject?.() || plan.constraints, ...payload.constraints };
  }

  await plan.save();
  return populatePlan(plan._id);
}

/**
 * Run the automatic generator for active classes in the academic year.
 */
async function generateTimetable({ academicYear, classRoomIds, userId, planId } = {}) {
  const year = await resolveAcademicYear(academicYear);
  if (!year) throw Object.assign(new Error('No academic year found'), { status: 400 });

  let plan;
  if (planId) {
    plan = await TimetablePlan.findById(planId);
    if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });
  } else {
    plan = await TimetablePlan.findOne({ academicYear: year._id, status: 'draft' }).sort({ updatedAt: -1 });
    if (!plan) {
      const created = await getOrCreatePlan({ academicYear: year._id, userId });
      plan = await TimetablePlan.findById(created._id);
    }
  }

  if (!plan.periods?.length) plan.periods = DEFAULT_PERIODS;
  if (!plan.facilities?.length) {
    plan.facilities = DEFAULT_FACILITIES.map((f) => ({ ...f, availableDays: [...DAYS] }));
  }

  const classFilter = {
    academicYear: year._id,
    status: 'active',
    ...(Array.isArray(classRoomIds) && classRoomIds.length ? { _id: { $in: classRoomIds } } : {})
  };
  const classes = await ClassRoom.find(classFilter)
    .populate('subjects.teacher', 'firstName lastName employeeCode subjects')
    .populate('classTeacher', 'firstName lastName employeeCode');

  if (!classes.length) {
    throw Object.assign(new Error('No active classes found for this academic year'), { status: 400 });
  }

  await ensureClassroomFacilities(plan, classes);

  const days = (plan.workingDays || DAYS).filter((d) => DAYS.includes(d));
  const teachPeriods = teachingIndexes(plan);
  const maxPerDay = plan.constraints?.maxPeriodsPerTeacherPerDay || 6;

  // Preserve locked slots from previous draft
  const lockedSlots = (plan.slots || []).filter((s) => s.locked);
  const slots = lockedSlots.map((s) => ({
    classRoom: s.classRoom,
    dayOfWeek: s.dayOfWeek,
    periodIndex: s.periodIndex,
    subject: s.subject,
    teacher: s.teacher,
    facility: s.facility,
    room: s.room,
    slotType: s.slotType,
    locked: true
  }));

  // Place break markers for every class
  const breakPeriods = (plan.periods || []).filter((p) => p.type === 'break');
  for (const room of classes) {
    for (const day of days) {
      for (const bp of breakPeriods) {
        const exists = slots.some(
          (s) => tid(s.classRoom) === tid(room._id) && s.dayOfWeek === day && s.periodIndex === bp.index
        );
        if (exists) continue;
        slots.push({
          classRoom: room._id,
          dayOfWeek: day,
          periodIndex: bp.index,
          subject: bp.label,
          teacher: undefined,
          facility: undefined,
          room: '',
          slotType: 'break',
          locked: true
        });
      }
    }
  }

  const occupied = occupiedSets(slots);
  const unplaced = [];

  // Build & place demands — harder specials first
  const allDemands = [];
  for (const room of classes) {
    allDemands.push(...buildDemands(room, plan));
  }
  const priority = { lab: 0, sports: 1, library: 2, subject: 3 };
  allDemands.sort((a, b) => (priority[a.slotType] ?? 9) - (priority[b.slotType] ?? 9));

  for (const demand of allDemands) {
    const homeName = `Room ${classLabel(demand.classRoom)}`;
    const facility = pickFacility(plan, demand.slotType, demand.subject, homeName);
    const facilityId = facility?._id;
    const candidates = shuffle(
      days.flatMap((day) => teachPeriods.map((periodIndex) => ({ day, periodIndex })))
    );

    let placed = false;
    for (const { day, periodIndex } of candidates) {
      if (
        !canPlace(plan, occupied, {
          classRoomId: demand.classRoom._id,
          teacherId: demand.teacher?._id || demand.teacher,
          facilityId,
          day,
          periodIndex,
          maxPerDay
        })
      ) {
        continue;
      }

      slots.push({
        classRoom: demand.classRoom._id,
        dayOfWeek: day,
        periodIndex,
        subject: demand.subject,
        teacher: demand.teacher?._id || demand.teacher,
        facility: facilityId,
        room: facility?.name || homeName,
        slotType: demand.slotType,
        locked: false
      });
      markOccupied(occupied, {
        classRoomId: demand.classRoom._id,
        teacherId: demand.teacher?._id || demand.teacher,
        facilityId,
        day,
        periodIndex
      });
      placed = true;
      break;
    }

    if (!placed) {
      unplaced.push({
        classRoom: demand.classRoom._id,
        subject: demand.subject,
        teacher: demand.teacher?._id || demand.teacher,
        slotType: demand.slotType,
        reason: 'No free slot without teacher/room conflict'
      });
    }
  }

  plan.slots = slots;
  plan.unplaced = unplaced;
  plan.status = 'draft';
  plan.generatedAt = new Date();
  plan.academicYear = year._id;
  if (userId) plan.createdBy = userId;

  // Save once so slot _ids exist for conflict linking
  await plan.save();
  plan.conflicts = detectConflicts(plan);
  plan.stats = computeStats(plan);
  await plan.save();

  log.info(`Generated timetable plan ${plan._id}: placed=${plan.stats.placed} unplaced=${plan.stats.unplaced} conflicts=${plan.stats.conflictCount}`);
  return populatePlan(plan._id);
}

/**
 * Re-run conflict detection without regenerating.
 */
async function validatePlan(planId) {
  const plan = await TimetablePlan.findById(planId)
    .populate('slots.classRoom', 'name section')
    .populate('slots.teacher', 'firstName lastName employeeCode');
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });

  plan.conflicts = detectConflicts(plan);
  plan.stats = computeStats(plan);
  await plan.save();
  return populatePlan(plan._id);
}

/**
 * Move or swap a slot via drag-drop (classRoom + day + period).
 */
async function moveSlot(planId, { slotId, targetDay, targetPeriodIndex, swap = true } = {}) {
  const plan = await TimetablePlan.findById(planId);
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });
  if (plan.status === 'applied') {
    throw Object.assign(new Error('Cannot edit an applied plan'), { status: 400 });
  }

  const slot = plan.slots.id(slotId);
  if (!slot) throw Object.assign(new Error('Slot not found'), { status: 404 });
  if (slot.locked && slot.slotType === 'break') {
    throw Object.assign(new Error('Break periods cannot be moved'), { status: 400 });
  }

  const day = String(targetDay || '').toLowerCase();
  const periodIndex = Number(targetPeriodIndex);
  if (!DAYS.includes(day)) throw Object.assign(new Error('Invalid day'), { status: 400 });
  if (!plan.periods.some((p) => p.index === periodIndex)) {
    throw Object.assign(new Error('Invalid period'), { status: 400 });
  }

  const period = plan.periods.find((p) => p.index === periodIndex);
  if ((period?.type === 'break' || period?.type === 'assembly') && plan.constraints?.protectBreaks !== false) {
    throw Object.assign(new Error(`Cannot place a class during ${period.type} time`), { status: 400 });
  }

  const occupant = plan.slots.find(
    (s) =>
      String(s._id) !== String(slotId) &&
      tid(s.classRoom) === tid(slot.classRoom) &&
      s.dayOfWeek === day &&
      s.periodIndex === periodIndex
  );

  if (occupant) {
    if (occupant.locked && occupant.slotType === 'break') {
      throw Object.assign(new Error('Target is a break slot'), { status: 400 });
    }
    if (swap) {
      const fromDay = slot.dayOfWeek;
      const fromPeriod = slot.periodIndex;
      slot.dayOfWeek = day;
      slot.periodIndex = periodIndex;
      occupant.dayOfWeek = fromDay;
      occupant.periodIndex = fromPeriod;
    } else {
      throw Object.assign(new Error('Target cell is occupied'), { status: 400 });
    }
  } else {
    slot.dayOfWeek = day;
    slot.periodIndex = periodIndex;
  }

  await plan.save();
  const refreshed = await TimetablePlan.findById(planId)
    .populate('slots.classRoom', 'name section')
    .populate('slots.teacher', 'firstName lastName employeeCode');
  refreshed.conflicts = detectConflicts(refreshed);
  refreshed.stats = computeStats(refreshed);
  await refreshed.save();
  return populatePlan(planId);
}

/**
 * Edit subject / teacher / room on an existing generated slot.
 */
async function updateSlot(planId, { slotId, subject, teacher, room, slotType } = {}) {
  const plan = await TimetablePlan.findById(planId);
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });
  if (plan.status === 'applied') {
    throw Object.assign(new Error('Cannot edit an applied plan'), { status: 400 });
  }

  const slot = plan.slots.id(slotId);
  if (!slot) throw Object.assign(new Error('Slot not found'), { status: 404 });
  if (slot.slotType === 'break' || slot.locked) {
    throw Object.assign(new Error('Locked or break slots cannot be edited'), { status: 400 });
  }

  if (subject !== undefined) slot.subject = String(subject || '').trim();
  if (room !== undefined) slot.room = String(room || '').trim();
  if (teacher !== undefined) {
    slot.teacher = teacher ? teacher : undefined;
  }
  if (slotType && ['subject', 'lab', 'sports', 'library', 'free'].includes(slotType)) {
    slot.slotType = slotType;
  }

  await plan.save();
  const refreshed = await TimetablePlan.findById(planId)
    .populate('slots.classRoom', 'name section')
    .populate('slots.teacher', 'firstName lastName employeeCode');
  refreshed.conflicts = detectConflicts(refreshed);
  refreshed.stats = computeStats(refreshed);
  await refreshed.save();
  return populatePlan(planId);
}

/**
 * Create or update a teaching slot for class + day + period (manual assign).
 */
async function assignSlot(
  planId,
  { classRoom, dayOfWeek, periodIndex, subject, teacher, room, slotType } = {}
) {
  const plan = await TimetablePlan.findById(planId);
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });
  if (plan.status === 'applied') {
    throw Object.assign(new Error('Cannot edit an applied plan'), { status: 400 });
  }

  const day = String(dayOfWeek || '').toLowerCase();
  const pIndex = Number(periodIndex);
  if (!classRoom) throw Object.assign(new Error('Select a class'), { status: 400 });
  if (!DAYS.includes(day)) throw Object.assign(new Error('Invalid day'), { status: 400 });
  const period = (plan.periods || []).find((p) => Number(p.index) === pIndex);
  if (!period) throw Object.assign(new Error('Invalid period'), { status: 400 });
  if (period.type === 'break' || period.type === 'assembly') {
    throw Object.assign(new Error(`Cannot assign a teacher during ${period.type}`), { status: 400 });
  }

  const subjectName = String(subject || '').trim();
  if (!subjectName) throw Object.assign(new Error('Subject is required'), { status: 400 });
  if (!teacher) throw Object.assign(new Error('Select a teacher for this period'), { status: 400 });

  const type = ['subject', 'lab', 'sports', 'library', 'free'].includes(slotType) ? slotType : 'subject';
  let slot = plan.slots.find(
    (s) =>
      tid(s.classRoom) === tid(classRoom) &&
      s.dayOfWeek === day &&
      Number(s.periodIndex) === pIndex
  );

  if (slot) {
    if (slot.slotType === 'break' || slot.locked) {
      throw Object.assign(new Error('This period is locked'), { status: 400 });
    }
    slot.subject = subjectName;
    slot.teacher = teacher;
    slot.room = String(room || '').trim();
    slot.slotType = type === 'free' ? 'subject' : type;
  } else {
    plan.slots.push({
      classRoom,
      dayOfWeek: day,
      periodIndex: pIndex,
      subject: subjectName,
      teacher,
      room: String(room || '').trim(),
      slotType: type === 'free' ? 'subject' : type,
      locked: false
    });
  }

  await plan.save();
  const refreshed = await TimetablePlan.findById(planId)
    .populate('slots.classRoom', 'name section')
    .populate('slots.teacher', 'firstName lastName employeeCode');
  refreshed.conflicts = detectConflicts(refreshed);
  refreshed.stats = computeStats(refreshed);
  refreshed.unplaced = (refreshed.unplaced || []).filter(
    (row) =>
      !(
        tid(row.classRoom) === tid(classRoom) &&
        String(row.subject || '').toLowerCase() === subjectName.toLowerCase()
      )
  );
  await refreshed.save();
  return populatePlan(planId);
}

/**
 * Apply draft plan into live Timetable collection (replaces class×day docs for covered classes).
 */
async function applyPlan(planId) {
  const plan = await TimetablePlan.findById(planId);
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });

  const errors = (plan.conflicts || []).filter((c) => c.severity === 'error');
  if (errors.length) {
    throw Object.assign(
      new Error(`Resolve ${errors.length} conflict(s) before applying`),
      { status: 400, conflicts: errors }
    );
  }

  const periods = periodMap(plan);
  const classIds = [...new Set((plan.slots || []).map((s) => tid(s.classRoom)).filter(Boolean))];

  await Timetable.deleteMany({
    academicYear: plan.academicYear,
    classRoom: { $in: classIds }
  });

  const byClassDay = new Map();
  for (const slot of plan.slots || []) {
    if (slot.slotType === 'break' || slot.slotType === 'free') continue;
    if (!slot.teacher || !slot.subject) continue;
    const key = `${tid(slot.classRoom)}|${slot.dayOfWeek}`;
    if (!byClassDay.has(key)) byClassDay.set(key, []);
    const period = periods.get(slot.periodIndex);
    byClassDay.get(key).push({
      startTime: period?.startTime || '00:00',
      endTime: period?.endTime || '00:00',
      subject: slot.subject,
      teacher: slot.teacher,
      room: slot.room || ''
    });
  }

  for (const [key, periodList] of byClassDay) {
    const [classRoom, dayOfWeek] = key.split('|');
    periodList.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
    await Timetable.findOneAndUpdate(
      { classRoom, academicYear: plan.academicYear, dayOfWeek },
      { classRoom, academicYear: plan.academicYear, dayOfWeek, periods: periodList },
      { upsert: true, new: true, runValidators: true }
    );
  }

  plan.status = 'applied';
  plan.appliedAt = new Date();
  await plan.save();

  log.info(`Applied timetable plan ${plan._id} → ${byClassDay.size} class-day rows`);
  return populatePlan(plan._id);
}

function buildDashboard(plan) {
  if (!plan) {
    return {
      plan: null,
      summary: {
        placed: 0,
        unplaced: 0,
        conflictCount: 0,
        score: 0,
        teachingSlots: 0,
        facilities: 0,
        teachingPeriods: 0,
        breakPeriods: 0
      },
      conflictsByType: {},
      calendar: { days: DAYS, periods: [], cells: [] }
    };
  }

  const conflictsByType = {};
  for (const c of plan.conflicts || []) {
    conflictsByType[c.type] = (conflictsByType[c.type] || 0) + 1;
  }

  const days = plan.workingDays?.length ? plan.workingDays : DAYS;
  const periods = plan.periods || [];
  const cells = (plan.slots || []).map((slot) => ({
    _id: slot._id,
    classRoom: slot.classRoom,
    classLabel: classLabel(slot.classRoom),
    dayOfWeek: slot.dayOfWeek,
    periodIndex: slot.periodIndex,
    subject: slot.subject,
    teacher: slot.teacher,
    teacherLabel: teacherLabel(slot.teacher),
    room: slot.room,
    facility: slot.facility,
    slotType: slot.slotType,
    locked: !!slot.locked
  }));

  return {
    plan,
    summary: {
      ...(plan.stats || {}),
      facilities: (plan.facilities || []).length,
      teachingPeriods: periods.filter((p) => p.type === 'teaching').length,
      breakPeriods: periods.filter((p) => p.type === 'break').length,
      status: plan.status,
      generatedAt: plan.generatedAt,
      appliedAt: plan.appliedAt
    },
    conflictsByType,
    calendar: { days, periods, cells },
    teachers: undefined
  };
}

async function listTeachersForAvailability() {
  return Teacher.find({ status: 'active' })
    .select('firstName lastName employeeCode subjects')
    .sort({ firstName: 1 })
    .lean();
}

async function listClassesForPlan(plan) {
  const academicYear = tid(plan?.academicYear);
  if (!academicYear) return [];
  return ClassRoom.find({ academicYear, status: 'active' })
    .select('name section')
    .sort({ name: 1, section: 1 })
    .lean();
}

module.exports = {
  DAYS,
  DEFAULT_PERIODS,
  DEFAULT_FACILITIES,
  detectConflicts,
  computeStats,
  getOrCreatePlan,
  reopenPlanForEdit,
  resetPlan,
  updatePlanConfig,
  generateTimetable,
  validatePlan,
  moveSlot,
  updateSlot,
  assignSlot,
  applyPlan,
  buildDashboard,
  populatePlan,
  listTeachersForAvailability,
  listClassesForPlan,
  resolveAcademicYear
};
