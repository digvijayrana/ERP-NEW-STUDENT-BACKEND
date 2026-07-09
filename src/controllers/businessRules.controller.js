const asyncHandler = require('../middleware/asyncHandler');
const { getFrameworkCatalog, getEffectivePolicy } = require('../services/businessRules.service');
const { getPolicySection, listConfigurationVersions } = require('../services/governanceConfig.service');
const { HTTP_STATUS } = require('../constants');

exports.catalog = asyncHandler(async (_req, res) => {
  res.json(getFrameworkCatalog());
});

exports.policies = asyncHandler(async (req, res) => {
  const section = req.query.section;
  const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();
  if (section) {
    const [current, effective] = await Promise.all([
      getPolicySection(section),
      getEffectivePolicy(section, asOf)
    ]);
    return res.json({ section, asOf, current, effective });
  }
  res.json({ message: 'Provide section query parameter' });
});

exports.policyHistory = asyncHandler(async (req, res) => {
  const section = req.params.section;
  const versions = await listConfigurationVersions(section, Number(req.query.limit) || 20);
  res.json({ section, versions });
});

exports.effectivePolicy = asyncHandler(async (req, res) => {
  const { section } = req.params;
  const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();
  if (!section) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Section is required' });
  const policy = await getEffectivePolicy(section, asOf);
  res.json({ section, asOf, policy });
});
