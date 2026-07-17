const asyncHandler = require('../middleware/asyncHandler');
const AdmissionLead = require('../models/AdmissionLead');
const assistant = require('../services/admissionAssistant.service');
const { auditOnUpdate } = require('../utils/auditFields');
const { logEntityCreate, logEntityUpdate } = require('../services/activityLog.service');
const { sendAdmissionLeadNotification } = require('../services/email.service');
const { HTTP_STATUS } = require('../constants');

const MODULE = 'admission_assistant';

function publicSessionId(req) {
  return String(req.body?.sessionId || req.headers['x-chat-session'] || '').trim() || `web-${Date.now()}`;
}

// ── Public (landing chatbot) ───────────────────────────────────────────────

exports.publicFaq = asyncHandler(async (_req, res) => {
  res.json({ faqs: assistant.FAQ, classOptions: assistant.CLASS_OPTIONS });
});

exports.publicEstimateFees = asyncHandler(async (req, res) => {
  const className = req.query.className || req.body?.className;
  const academicYear = req.query.academicYear || req.body?.academicYear;
  const estimate = await assistant.estimateFees(className, academicYear);
  res.json(estimate);
});

exports.publicEligibility = asyncHandler(async (req, res) => {
  const result = assistant.checkEligibility({
    dateOfBirth: req.body?.dateOfBirth || req.query.dateOfBirth,
    applyingClass: req.body?.applyingClass || req.query.applyingClass || req.query.className
  });
  res.json(result);
});

exports.publicChat = asyncHandler(async (req, res) => {
  const sessionId = publicSessionId(req);
  const result = await assistant.chat({
    sessionId,
    message: req.body?.message,
    context: req.body?.context || {}
  });
  res.json({ sessionId, ...result });
});

exports.publicCreateLead = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.parentName || !body.childName) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'parentName and childName are required' });
  }
  if (body.parentPhone && !/^\d{10}$/.test(String(body.parentPhone))) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'parentPhone must be 10 digits' });
  }

  const sessionId = publicSessionId(req);
  const lead = await assistant.upsertLeadFromChat(sessionId, {
    parentName: body.parentName,
    childName: body.childName,
    parentPhone: body.parentPhone,
    parentEmail: body.parentEmail,
    relation: body.relation,
    applyingClass: body.applyingClass,
    dateOfBirth: body.dateOfBirth,
    previousSchool: body.previousSchool,
    notes: body.notes
  });

  logEntityCreate({
    module: MODULE,
    entityId: lead._id,
    entityLabel: lead.leadCode,
    action: 'admission_lead_create',
    description: `Admission lead ${lead.leadCode} captured via chatbot`,
    user: req.user || { name: 'Public chatbot' }
  });

  res.status(HTTP_STATUS.CREATED).json(lead);
});

// ── Admin CRM ──────────────────────────────────────────────────────────────

exports.dashboard = asyncHandler(async (_req, res) => {
  res.json(await assistant.dashboard());
});

exports.analytics = asyncHandler(async (_req, res) => {
  res.json(await assistant.analytics());
});

exports.pipeline = asyncHandler(async (_req, res) => {
  res.json(await assistant.pipelineBoard());
});

exports.listLeads = asyncHandler(async (req, res) => {
  const leads = await assistant.listLeads({
    stage: req.query.stage,
    q: req.query.q || req.query.search,
    limit: req.query.limit
  });
  res.json({ count: leads.length, leads });
});

exports.getLead = asyncHandler(async (req, res) => {
  const lead = await AdmissionLead.findById(req.params.id).lean();
  if (!lead) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Lead not found' });
  res.json(lead);
});

exports.updateLead = asyncHandler(async (req, res) => {
  const lead = await AdmissionLead.findById(req.params.id);
  if (!lead) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Lead not found' });

  const allowed = [
    'parentName',
    'parentPhone',
    'parentEmail',
    'relation',
    'childName',
    'childGender',
    'dateOfBirth',
    'applyingClass',
    'previousSchool',
    'academicYear',
    'stage',
    'source',
    'notes',
    'tags',
    'assignedTo'
  ];
  for (const field of allowed) {
    if (req.body[field] !== undefined) lead[field] = req.body[field];
  }
  if (req.body.applyingClass) lead.applyingClass = assistant.normalizeClass(req.body.applyingClass);

  lead.eligibility = assistant.checkEligibility(lead);
  const qualification = assistant.qualifyLead(lead);
  lead.qualificationScore = qualification.score;
  lead.qualificationLabel = qualification.label;
  lead.scholarship = assistant.suggestScholarship(lead);
  if (lead.applyingClass) {
    lead.feeEstimate = await assistant.estimateFees(lead.applyingClass, lead.academicYear);
  }
  lead.lastActivityAt = new Date();
  Object.assign(lead, auditOnUpdate(req.user));
  await lead.save();

  logEntityUpdate({
    module: MODULE,
    entityId: lead._id,
    entityLabel: lead.leadCode,
    action: 'admission_lead_update',
    description: `Lead ${lead.leadCode} updated (stage: ${lead.stage})`,
    user: req.user
  });

  res.json(lead);
});

exports.updateStage = asyncHandler(async (req, res) => {
  const lead = await AdmissionLead.findById(req.params.id);
  if (!lead) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Lead not found' });
  const stage = req.body?.stage;
  if (!AdmissionLead.PIPELINE_STAGES.includes(stage)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Invalid pipeline stage' });
  }
  const previous = lead.stage;
  lead.stage = stage;
  lead.lastActivityAt = new Date();
  Object.assign(lead, auditOnUpdate(req.user));
  await lead.save();

  logEntityUpdate({
    module: MODULE,
    entityId: lead._id,
    entityLabel: lead.leadCode,
    action: 'admission_lead_stage',
    description: `Lead ${lead.leadCode}: ${previous} → ${stage}`,
    user: req.user
  });

  res.json(lead);
});

exports.verifyDocument = asyncHandler(async (req, res) => {
  const lead = await AdmissionLead.findById(req.params.id);
  if (!lead) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Lead not found' });
  const { key, status, notes } = req.body || {};
  const doc = (lead.documents || []).find((d) => d.key === key);
  if (!doc) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Unknown document key' });
  if (!['missing', 'submitted', 'verified', 'rejected'].includes(status)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Invalid document status' });
  }
  doc.status = status;
  if (notes !== undefined) doc.notes = notes;

  const pending = lead.documents.filter((d) => d.status === 'missing' || d.status === 'rejected');
  if (pending.length && !['converted', 'lost', 'interview_scheduled'].includes(lead.stage)) {
    lead.stage = 'documents_pending';
  }

  const qualification = assistant.qualifyLead(lead);
  lead.qualificationScore = qualification.score;
  lead.qualificationLabel = qualification.label;
  lead.lastActivityAt = new Date();
  Object.assign(lead, auditOnUpdate(req.user));
  await lead.save();

  res.json(lead);
});

exports.bookInterview = asyncHandler(async (req, res) => {
  const lead = await AdmissionLead.findById(req.params.id);
  if (!lead) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Lead not found' });
  const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'scheduledAt is required' });
  }
  lead.interview = {
    scheduledAt,
    mode: req.body.mode || 'in_person',
    status: 'scheduled',
    notes: req.body.notes || ''
  };
  lead.stage = 'interview_scheduled';
  lead.lastActivityAt = new Date();
  Object.assign(lead, auditOnUpdate(req.user));
  await lead.save();
  res.json(lead);
});

exports.suggestScholarship = asyncHandler(async (req, res) => {
  const lead = await AdmissionLead.findById(req.params.id);
  if (!lead) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Lead not found' });
  lead.scholarship = assistant.suggestScholarship(lead);
  if (lead.scholarship.suggested) lead.stage = 'scholarship_review';
  lead.lastActivityAt = new Date();
  Object.assign(lead, auditOnUpdate(req.user));
  await lead.save();
  res.json(lead);
});

exports.notifyLead = asyncHandler(async (req, res) => {
  const lead = await AdmissionLead.findById(req.params.id);
  if (!lead) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Lead not found' });
  if (!lead.parentEmail) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Lead has no parent email' });
  }
  await sendAdmissionLeadNotification({
    to: lead.parentEmail,
    parentName: lead.parentName,
    childName: lead.childName,
    leadCode: lead.leadCode,
    stage: lead.stage,
    applyingClass: lead.applyingClass,
    feeTotal: lead.feeEstimate?.total,
    message: req.body?.message
  });
  res.json({ emailed: true });
});
