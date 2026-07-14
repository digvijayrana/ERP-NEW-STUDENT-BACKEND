const mongoose = require('mongoose');
const FeeStructure = require('../models/FeeStructure');
const ClassRoom = require('../models/ClassRoom');
const asyncHandler = require('../middleware/asyncHandler');
const { auditOnCreate, auditOnUpdate } = require('../utils/auditFields');
const { logEntityCreate, logEntityUpdate } = require('../services/activityLog.service');
const { HTTP_STATUS } = require('../constants');

const FEE_FREQUENCIES = ['one_time', 'monthly', 'quarterly', 'half_yearly', 'yearly'];
const MODULE = 'fees';

/**
 * Resolve the target class NAME for a fee structure request. Prefers an explicit
 * `className`; otherwise derives it from a `classRoom` id (backward compatibility).
 */
async function resolveClassName({ className, classRoom }) {
  const explicit = String(className || '').trim();
  if (explicit) return explicit;
  if (classRoom && mongoose.Types.ObjectId.isValid(classRoom)) {
    const room = await ClassRoom.findById(classRoom).select('name');
    if (room?.name) return String(room.name).trim();
  }
  return '';
}

function sanitizeComponents(rawComponents) {
  if (!Array.isArray(rawComponents)) return [];
  return rawComponents
    .map((component) => {
      const label = String(component.label || '').trim();
      const key = String(component.key || label).trim().toLowerCase().replace(/\s+/g, '_');
      const amount = Math.max(Number(component.amount) || 0, 0);
      const frequency = FEE_FREQUENCIES.includes(component.frequency) ? component.frequency : 'monthly';
      const newAdmissionOnly = frequency === 'one_time' ? Boolean(component.newAdmissionOnly) : false;
      return { key, label, amount, frequency, newAdmissionOnly };
    })
    .filter((component) => component.label && component.key);
}

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.academicYear && mongoose.Types.ObjectId.isValid(req.query.academicYear)) {
    filter.academicYear = req.query.academicYear;
  }
  if (req.query.className) {
    filter.className = String(req.query.className).trim();
  }
  if (req.query.classRoom && mongoose.Types.ObjectId.isValid(req.query.classRoom)) {
    filter.classRoom = req.query.classRoom;
  }

  const structures = await FeeStructure.find(filter)
    .populate('classRoom', 'name section')
    .populate('academicYear', 'name')
    .sort({ updatedAt: -1 });

  res.json(structures);
});

exports.getForClass = asyncHandler(async (req, res) => {
  const { academicYear } = req.query;
  if (!academicYear) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'academicYear is required' });
  }

  const className = await resolveClassName(req.query);
  if (!className) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'className or classRoom is required' });
  }

  // Prefer the class-level structure; fall back to a legacy section-specific one.
  let structure = await FeeStructure.findOne({ academicYear, className })
    .populate('classRoom', 'name section')
    .populate('academicYear', 'name');

  if (!structure && req.query.classRoom && mongoose.Types.ObjectId.isValid(req.query.classRoom)) {
    structure = await FeeStructure.findOne({ academicYear, classRoom: req.query.classRoom })
      .populate('classRoom', 'name section')
      .populate('academicYear', 'name');
  }

  return res.json(structure || null);
});

exports.upsert = asyncHandler(async (req, res) => {
  const { academicYear } = req.body;
  if (!academicYear) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'academicYear is required' });
  }

  const className = await resolveClassName(req.body);
  if (!className) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'className or classRoom is required' });
  }

  const components = sanitizeComponents(req.body.components);
  const existing = await FeeStructure.findOne({ academicYear, className });

  if (existing) {
    existing.components = components;
    if (req.body.status) existing.status = req.body.status;
    Object.assign(existing, auditOnUpdate(req.user));
    await existing.save();

    // Keep every section of this class linked, and refresh monthly tuition.
    const monthlyFee = components
      .filter((component) => component.key === 'tuition')
      .reduce((sum, component) => {
        const factor = { monthly: 1, quarterly: 1 / 3, half_yearly: 1 / 6, yearly: 1 / 12, one_time: 0 }[component.frequency] ?? 1;
        return sum + Math.max(Number(component.amount) || 0, 0) * factor;
      }, 0);
    await ClassRoom.updateMany(
      { academicYear, name: className },
      { $set: { feeStructure: existing._id, monthlyFee: Math.round(monthlyFee) } }
    );

    logEntityUpdate({
      module: MODULE,
      entityId: existing._id,
      entityLabel: 'fee-structure',
      action: 'fee_structure_update',
      description: `Fee structure updated for class ${className} (${components.length} components)`,
      user: req.user
    });

    const populated = await existing.populate([
      { path: 'classRoom', select: 'name section' },
      { path: 'academicYear', select: 'name' }
    ]);
    return res.json(populated);
  }

  const created = await FeeStructure.create({
    academicYear,
    className,
    components,
    status: req.body.status || 'active',
    ...auditOnCreate(req.user)
  });

  logEntityCreate({
    module: MODULE,
    entityId: created._id,
    entityLabel: 'fee-structure',
    action: 'fee_structure_create',
    description: `Fee structure created for class ${className} (${components.length} components)`,
    user: req.user
  });

  // Back-link the new structure to every existing section of this class + year.
  const monthlyFee = components
    .filter((component) => component.key === 'tuition')
    .reduce((sum, component) => {
      const factor = { monthly: 1, quarterly: 1 / 3, half_yearly: 1 / 6, yearly: 1 / 12, one_time: 0 }[component.frequency] ?? 1;
      return sum + Math.max(Number(component.amount) || 0, 0) * factor;
    }, 0);
  await ClassRoom.updateMany(
    { academicYear, name: className },
    { $set: { feeStructure: created._id, monthlyFee: Math.round(monthlyFee) } }
  );

  const populated = await created.populate([
    { path: 'classRoom', select: 'name section' },
    { path: 'academicYear', select: 'name' }
  ]);
  return res.status(HTTP_STATUS.CREATED).json(populated);
});

exports.remove = asyncHandler(async (req, res) => {
  const structure = await FeeStructure.findByIdAndDelete(req.params.id);
  if (!structure) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Fee structure not found' });

  // Unlink from any sections that referenced it.
  await ClassRoom.updateMany({ feeStructure: structure._id }, { $unset: { feeStructure: '' } });

  logEntityUpdate({
    module: MODULE,
    entityId: structure._id,
    entityLabel: 'fee-structure',
    action: 'fee_structure_delete',
    description: 'Fee structure deleted',
    user: req.user
  });

  return res.json({ deleted: true });
});
