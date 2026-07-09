const asyncHandler = require('../middleware/asyncHandler');
const { HTTP_STATUS } = require('../constants');
const {
  getConfiguration,
  updateConfigurationSection,
  listConfigurationVersions,
  CONFIG_SECTIONS
} = require('../services/governanceConfig.service');
const { buildDataQualityReport } = require('../services/dataQuality.service');
const { buildSystemHealth } = require('../services/systemHealth.service');

exports.getConfiguration = asyncHandler(async (req, res) => {
  const configuration = await getConfiguration();
  res.json(configuration);
});

exports.updateConfiguration = asyncHandler(async (req, res) => {
  const { section, data } = req.body;
  if (!section || !CONFIG_SECTIONS.includes(section)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Valid configuration section is required' });
  }
  if (!data || typeof data !== 'object') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Configuration data is required' });
  }
  const configuration = await updateConfigurationSection(section, data, req.user, { req });
  res.json(configuration);
});

exports.listVersions = asyncHandler(async (req, res) => {
  const versions = await listConfigurationVersions(req.query.section, Number(req.query.limit) || 20);
  res.json({ versions });
});

exports.dataQualityReport = asyncHandler(async (req, res) => {
  const report = await buildDataQualityReport();
  res.json(report);
});

exports.systemHealth = asyncHandler(async (req, res) => {
  const health = await buildSystemHealth(req.user, req.permissions);
  res.json(health);
});

exports.sections = asyncHandler(async (req, res) => {
  res.json({ sections: CONFIG_SECTIONS });
});
