const SchoolConfiguration = require('../models/SchoolConfiguration');
const ConfigurationVersion = require('../models/ConfigurationVersion');
const DEFAULTS = require('../config/governance.defaults');
const { recordActivity } = require('./activityLog.service');
const { MODULES, ACTIONS } = require('../constants/activityActions');
const { getOrSet, get, invalidateNamespace } = require('./cache.service');
const { CACHE_TTL_MS } = require('../config/performance.config');

const CONFIG_SECTIONS = [
  'school',
  'academicCalendar',
  'feePolicies',
  'attendanceRules',
  'promotionRules',
  'busRules',
  'payrollPolicies',
  'softDeletePolicy'
];

function mergeWithDefaults(config) {
  const doc = config?.toObject ? config.toObject() : config || {};
  return {
    key: doc.key || 'master',
    version: doc.version || 1,
    school: { ...DEFAULTS.school, ...(doc.school || {}) },
    academicCalendar: { ...DEFAULTS.academicCalendar, ...(doc.academicCalendar || {}) },
    feePolicies: { ...DEFAULTS.feePolicies, ...(doc.feePolicies || {}) },
    attendanceRules: { ...DEFAULTS.attendanceRules, ...(doc.attendanceRules || {}) },
    promotionRules: { ...DEFAULTS.promotionRules, ...(doc.promotionRules || {}) },
    busRules: { ...DEFAULTS.busRules, ...(doc.busRules || {}) },
    payrollPolicies: { ...DEFAULTS.payrollPolicies, ...(doc.payrollPolicies || {}) },
    softDeletePolicy: { ...DEFAULTS.softDeletePolicy, ...(doc.softDeletePolicy || {}) },
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt
  };
}

async function loadConfiguration(force = false) {
  if (force) invalidateNamespace('governance');
  return getOrSet('governance', 'master', CACHE_TTL_MS.governance, async () => {
    let config = await SchoolConfiguration.findOne({ key: 'master' });
    if (!config) {
      config = await SchoolConfiguration.seedDefaults();
    }
    return mergeWithDefaults(config);
  });
}

async function getConfiguration() {
  return loadConfiguration();
}

async function getPolicySection(section) {
  const config = await loadConfiguration();
  return config[section] || DEFAULTS[section] || {};
}

async function getSoftDeletePolicy() {
  return getPolicySection('softDeletePolicy');
}

async function getMandatoryDocTypes() {
  const { MANDATORY_DOC_TYPES } = require('../config/workflow.config');
  return MANDATORY_DOC_TYPES;
}

async function updateConfigurationSection(section, payload, user, options = {}) {
  if (!CONFIG_SECTIONS.includes(section)) {
    const error = new Error('Invalid configuration section');
    error.status = 400;
    throw error;
  }

  let config = await SchoolConfiguration.findOne({ key: 'master' });
  if (!config) {
    config = await SchoolConfiguration.seedDefaults();
  }

  const { effectiveFrom, ...sectionPayload } = payload || {};
  const previous = { ...(config[section]?.toObject?.() || config[section] || {}) };
  config[section] = { ...previous, ...sectionPayload };
  config.version = (config.version || 1) + 1;
  if (user?._id) config.updatedBy = user._id;
  await config.save();

  const effectiveDate = effectiveFrom ? new Date(effectiveFrom) : new Date();
  await ConfigurationVersion.create({
    section,
    version: config.version,
    snapshot: config[section],
    effectiveFrom: effectiveDate,
    changeSummary: options.changeSummary || `Updated ${section} configuration`,
    changedBy: user?._id || user?.id,
    changedAt: new Date()
  });

  recordActivity({
    module: MODULES.GOVERNANCE,
    entityId: config._id,
    entityLabel: section,
    action: ACTIONS.CONFIG_CHANGE,
    description: `Governance configuration updated: ${section}`,
    user,
    req: options.req,
    previousValue: previous,
    updatedValue: config[section],
    meta: { section, version: config.version, effectiveFrom: effectiveDate }
  });

  invalidateNamespace('governance');
  invalidateNamespace('dashboard');
  return loadConfiguration(true);
}

async function listConfigurationVersions(section, limit = 20) {
  const filter = section ? { section } : {};
  return ConfigurationVersion.find(filter).sort({ effectiveFrom: -1, version: -1 }).limit(limit).lean();
}

async function getEffectivePolicySection(section, asOf = new Date()) {
  const point = new Date(asOf);
  const version = await ConfigurationVersion.findOne({
    section,
    effectiveFrom: { $lte: point }
  })
    .sort({ effectiveFrom: -1, version: -1 })
    .lean();
  if (version?.snapshot) return version.snapshot;
  return getPolicySection(section);
}

function getCachedSchoolBranding() {
  const cached = get('governance', 'master');
  const school = cached?.school || DEFAULTS.school;
  return {
    name: school.name || process.env.SCHOOL_NAME || 'Student ERP School',
    address: school.address || process.env.SCHOOL_ADDRESS || '123 Education Street, City - 000000',
    phone: school.phone || process.env.SCHOOL_PHONE || '',
    email: school.email || process.env.SCHOOL_EMAIL || '',
    website: school.website || process.env.SCHOOL_WEBSITE || '',
    affiliation: school.affiliation || process.env.SCHOOL_AFFILIATION || ''
  };
}

function invalidateCache() {
  invalidateNamespace('governance');
}

module.exports = {
  CONFIG_SECTIONS,
  getConfiguration,
  getPolicySection,
  getSoftDeletePolicy,
  getMandatoryDocTypes,
  updateConfigurationSection,
  listConfigurationVersions,
  getEffectivePolicySection,
  invalidateCache,
  mergeWithDefaults,
  getCachedSchoolBranding
};
