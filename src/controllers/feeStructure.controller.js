const mongoose = require('mongoose');
const FeeStructure = require('../models/FeeStructure');
const asyncHandler = require('../middleware/asyncHandler');
const { auditOnCreate, auditOnUpdate } = require('../utils/auditFields');
const { logEntityCreate, logEntityUpdate } = require('../services/activityLog.service');
const { HTTP_STATUS } = require('../constants');

const FEE_FREQUENCIES = ['one_time', 'monthly', 'quarterly', 'half_yearly', 'yearly'];
const MODULE = 'fees';

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
  const { academicYear, classRoom } = req.query;
  if (!academicYear || !classRoom) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'academicYear and classRoom are required' });
  }
  const structure = await FeeStructure.findOne({ academicYear, classRoom })
    .populate('classRoom', 'name section')
    .populate('academicYear', 'name');
  return res.json(structure || null);
});

exports.upsert = asyncHandler(async (req, res) => {
  const { academicYear, classRoom } = req.body;
  if (!academicYear || !classRoom) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'academicYear and classRoom are required' });
  }

  const components = sanitizeComponents(req.body.components);
  const existing = await FeeStructure.findOne({ academicYear, classRoom });

  if (existing) {
    existing.components = components;
    if (req.body.status) existing.status = req.body.status;
    Object.assign(existing, auditOnUpdate(req.user));
    await existing.save();

    logEntityUpdate({
      module: MODULE,
      entityId: existing._id,
      entityLabel: 'fee-structure',
      action: 'fee_structure_update',
      description: `Fee structure updated (${components.length} components)`,
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
    classRoom,
    components,
    status: req.body.status || 'active',
    ...auditOnCreate(req.user)
  });

  logEntityCreate({
    module: MODULE,
    entityId: created._id,
    entityLabel: 'fee-structure',
    action: 'fee_structure_create',
    description: `Fee structure created (${components.length} components)`,
    user: req.user
  });

  const populated = await created.populate([
    { path: 'classRoom', select: 'name section' },
    { path: 'academicYear', select: 'name' }
  ]);
  return res.status(HTTP_STATUS.CREATED).json(populated);
});

exports.remove = asyncHandler(async (req, res) => {
  const structure = await FeeStructure.findByIdAndDelete(req.params.id);
  if (!structure) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Fee structure not found' });

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
