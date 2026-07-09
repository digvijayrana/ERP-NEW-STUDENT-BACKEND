const asyncHandler = require('../middleware/asyncHandler');
const {
  listEligibleStudents,
  buildPreview,
  executePromotion,
  rollbackBatch,
  finalizeBatch,
  getBatch,
  buildPromotionReport
} = require('../services/promotion.service');
const { HTTP_STATUS } = require('../constants');
const { assertReversalAllowed, logReversal } = require('../services/businessRules.service');

exports.eligible = asyncHandler(async (req, res) => {
  const rows = await listEligibleStudents({
    fromAcademicYear: req.query.fromAcademicYear,
    fromClassRoom: req.query.fromClassRoom,
    toAcademicYear: req.query.toAcademicYear
  });
  res.json({ rows, total: rows.length });
});

exports.preview = asyncHandler(async (req, res) => {
  const preview = await buildPreview(req.body);
  res.json(preview);
});

exports.execute = asyncHandler(async (req, res) => {
  const batch = await executePromotion(req.body, req.user);
  res.status(HTTP_STATUS.CREATED).json(batch);
});

exports.rollback = asyncHandler(async (req, res) => {
  assertReversalAllowed('promotion_rollback', req.user, req.permissions);
  const batch = await rollbackBatch(req.params.id, req.user);
  logReversal({
    module: 'students',
    entityId: batch._id,
    entityLabel: `batch-${batch._id}`,
    reversalType: 'promotion_rollback',
    user: req.user,
    req,
    previousValue: { status: 'draft' },
    updatedValue: { status: batch.status }
  });
  res.json(batch);
});

exports.finalize = asyncHandler(async (req, res) => {
  const batch = await finalizeBatch(req.params.id, req.user);
  res.json(batch);
});

exports.getBatch = asyncHandler(async (req, res) => {
  const batch = await getBatch(req.params.id);
  res.json(batch);
});

exports.report = asyncHandler(async (req, res) => {
  const rows = await buildPromotionReport(req.params.type, req.query);
  res.json({ type: req.params.type, rows, total: rows.length });
});
