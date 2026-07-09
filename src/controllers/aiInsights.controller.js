const asyncHandler = require('../middleware/asyncHandler');
const AcademicYear = require('../models/AcademicYear');
const { buildManagementInsights, getStudentInsights, buildTrendAnalysis } = require('../services/aiInsightsEngine.service');
const { ROLES } = require('../constants');

exports.management = asyncHandler(async (req, res) => {
  const activeYear = await AcademicYear.findOne({ $or: [{ status: 'active' }, { isActive: true }] }).sort({ startDate: -1 }).lean();
  const teacherId = req.user.role === ROLES.TEACHER ? req.user.teacher : null;
  const insights = await buildManagementInsights(activeYear, teacherId, req.user);
  res.json(insights);
});

exports.student = asyncHandler(async (req, res) => {
  const activeYear = await AcademicYear.findOne({ $or: [{ status: 'active' }, { isActive: true }] }).sort({ startDate: -1 }).lean();
  const insight = await getStudentInsights(req.params.studentId, activeYear?._id, req.user);
  if (!insight) return res.status(404).json({ message: 'Student not found' });
  res.json(insight);
});

exports.trends = asyncHandler(async (req, res) => {
  const activeYear = await AcademicYear.findOne({ $or: [{ status: 'active' }, { isActive: true }] }).sort({ startDate: -1 }).lean();
  const trends = await buildTrendAnalysis(activeYear);
  res.json({ trends });
});

exports.config = asyncHandler(async (_req, res) => {
  const config = require('../config/aiScoring.config');
  res.json(config);
});
