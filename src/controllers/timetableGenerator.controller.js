const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS } = require('../constants');
const { timetablePlanPdf } = require('../services/pdf.service');
const {
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
} = require('../services/timetableGenerator.service');
const TimetablePlan = require('../models/TimetablePlan');
const { logEntityUpdate } = require('../services/activityLog.service');

const MODULE = 'timetable_generator';

function statusFrom(error) {
  return error.status || HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

exports.dashboard = asyncHandler(async (req, res) => {
  try {
    const plan = await getOrCreatePlan({
      academicYear: req.query.academicYear || undefined,
      userId: req.user?._id
    });
    const [teachers, classes] = await Promise.all([
      listTeachersForAvailability(),
      listClassesForPlan(plan)
    ]);
    const dashboard = buildDashboard(plan);
    dashboard.teachers = teachers;
    dashboard.classes = classes;
    res.json(dashboard);
  } catch (error) {
    res.status(statusFrom(error)).json({ message: error.message });
  }
});

exports.getPlan = asyncHandler(async (req, res) => {
  const plan = await populatePlan(req.params.id);
  if (!plan) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Plan not found' });
  res.json(plan);
});

exports.updateConfig = asyncHandler(async (req, res) => {
  try {
    const plan = await updatePlanConfig(req.params.id, req.body || {});
    logEntityUpdate({
      module: MODULE,
      entityId: plan._id,
      entityLabel: plan.name,
      action: 'timetable_config_updated',
      description: `Updated timetable generator constraints for ${plan.name}`,
      user: req.user
    });
    res.json(plan);
  } catch (error) {
    res.status(statusFrom(error)).json({ message: error.message });
  }
});

exports.generate = asyncHandler(async (req, res) => {
  try {
    const plan = await generateTimetable({
      academicYear: req.body?.academicYear || req.query.academicYear,
      classRoomIds: req.body?.classRoomIds,
      planId: req.body?.planId || req.params.id,
      userId: req.user?._id
    });
    logEntityUpdate({
      module: MODULE,
      entityId: plan._id,
      entityLabel: plan.name,
      action: 'timetable_generated',
      description: `AI timetable generated (${plan.stats?.placed || 0} placed, ${plan.stats?.conflictCount || 0} conflicts)`,
      user: req.user,
      meta: plan.stats
    });
    res.status(HTTP_STATUS.CREATED).json(buildDashboard(plan));
  } catch (error) {
    res.status(statusFrom(error)).json({ message: error.message });
  }
});

exports.validate = asyncHandler(async (req, res) => {
  try {
    const plan = await validatePlan(req.params.id);
    res.json(buildDashboard(plan));
  } catch (error) {
    res.status(statusFrom(error)).json({ message: error.message });
  }
});

exports.moveSlot = asyncHandler(async (req, res) => {
  try {
    const plan = await moveSlot(req.params.id, {
      slotId: req.body?.slotId,
      targetDay: req.body?.targetDay,
      targetPeriodIndex: req.body?.targetPeriodIndex,
      swap: req.body?.swap !== false
    });
    res.json(buildDashboard(plan));
  } catch (error) {
    res.status(statusFrom(error)).json({ message: error.message, conflicts: error.conflicts });
  }
});

exports.updateSlot = asyncHandler(async (req, res) => {
  try {
    const plan = await updateSlot(req.params.id, {
      slotId: req.body?.slotId || req.params.slotId,
      subject: req.body?.subject,
      teacher: req.body?.teacher,
      room: req.body?.room,
      slotType: req.body?.slotType
    });
    const teachers = await listTeachersForAvailability();
    const classes = await listClassesForPlan(plan);
    const dashboard = buildDashboard(plan);
    dashboard.teachers = teachers;
    dashboard.classes = classes;
    res.json(dashboard);
  } catch (error) {
    res.status(statusFrom(error)).json({ message: error.message, conflicts: error.conflicts });
  }
});

exports.assignSlot = asyncHandler(async (req, res) => {
  try {
    const plan = await assignSlot(req.params.id, {
      classRoom: req.body?.classRoom,
      dayOfWeek: req.body?.dayOfWeek,
      periodIndex: req.body?.periodIndex,
      subject: req.body?.subject,
      teacher: req.body?.teacher,
      room: req.body?.room,
      slotType: req.body?.slotType
    });
    const teachers = await listTeachersForAvailability();
    const classes = await listClassesForPlan(plan);
    const dashboard = buildDashboard(plan);
    dashboard.teachers = teachers;
    dashboard.classes = classes;
    res.json(dashboard);
  } catch (error) {
    res.status(statusFrom(error)).json({ message: error.message, conflicts: error.conflicts });
  }
});

exports.reopenForEdit = asyncHandler(async (req, res) => {
  try {
    const plan = await reopenPlanForEdit(req.params.id);
    const teachers = await listTeachersForAvailability();
    const classes = await listClassesForPlan(plan);
    const dashboard = buildDashboard(plan);
    dashboard.teachers = teachers;
    dashboard.classes = classes;
    res.json(dashboard);
  } catch (error) {
    res.status(statusFrom(error)).json({ message: error.message });
  }
});

exports.resetPlan = asyncHandler(async (req, res) => {
  try {
    const plan = await resetPlan(req.params.id, {
      classRoom: req.body?.classRoom || req.query?.classRoom
    });
    const teachers = await listTeachersForAvailability();
    const classes = await listClassesForPlan(plan);
    const dashboard = buildDashboard(plan);
    dashboard.teachers = teachers;
    dashboard.classes = classes;
    res.json(dashboard);
  } catch (error) {
    res.status(statusFrom(error)).json({ message: error.message });
  }
});

exports.apply = asyncHandler(async (req, res) => {
  try {
    const plan = await applyPlan(req.params.id);
    logEntityUpdate({
      module: MODULE,
      entityId: plan._id,
      entityLabel: plan.name,
      action: 'timetable_applied',
      description: `Applied AI timetable plan to live schedules`,
      user: req.user
    });
    res.json(buildDashboard(plan));
  } catch (error) {
    res.status(statusFrom(error)).json({ message: error.message, conflicts: error.conflicts });
  }
});

exports.exportPdf = asyncHandler(async (req, res) => {
  const plan = await populatePlan(req.params.id);
  if (!plan) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Plan not found' });
  const classRoomId = req.query.classRoom || undefined;
  timetablePlanPdf(res, plan, { classRoomId });
});

exports.listPlans = asyncHandler(async (req, res) => {
  const year = await resolveAcademicYear(req.query.academicYear);
  const filter = year ? { academicYear: year._id } : {};
  const plans = await TimetablePlan.find(filter)
    .select('name status stats generatedAt appliedAt academicYear createdAt')
    .populate('academicYear', 'name')
    .sort({ updatedAt: -1 })
    .limit(20);
  res.json(plans);
});
