const asyncHandler = require('../middleware/asyncHandler');
const {
  buildDashboard,
  loadPredictionUniverse,
  buildReminders
} = require('../services/feePrediction.service');
const { sendFeePaymentReminder } = require('../services/email.service');
const { logEntityUpdate } = require('../services/activityLog.service');
const { HTTP_STATUS } = require('../constants');

const MODULE = 'fee_prediction';

exports.dashboard = asyncHandler(async (req, res) => {
  const data = await buildDashboard({
    academicYear: req.query.academicYear || undefined,
    classRoom: req.query.classRoom || undefined
  });
  res.json(data);
});

exports.predictions = asyncHandler(async (req, res) => {
  const riskOnly = String(req.query.riskOnly || '') === 'true';
  const rows = await loadPredictionUniverse({
    academicYear: req.query.academicYear || undefined,
    classRoom: req.query.classRoom || undefined,
    riskOnly
  });
  res.json({
    generatedAt: new Date().toISOString(),
    count: rows.length,
    predictions: rows.filter((row) => row.pendingAmount > 0)
  });
});

exports.prepareReminders = asyncHandler(async (req, res) => {
  const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
  if (!studentIds.length) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Select at least one student' });
  }
  const reminders = await buildReminders(studentIds);
  res.json({ count: reminders.length, reminders });
});

/**
 * Send reminders via email (and return WhatsApp deep-links for one-click outreach).
 * channel: 'email' | 'whatsapp' | 'all'
 */
exports.sendReminders = asyncHandler(async (req, res) => {
  const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
  const channel = String(req.body?.channel || 'all').toLowerCase();
  if (!studentIds.length) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Select at least one student' });
  }

  const reminders = await buildReminders(studentIds);
  const results = [];

  for (const row of reminders) {
    const entry = {
      studentId: row.studentId,
      studentName: row.studentName,
      emailSent: false,
      emailSkipped: false,
      whatsappUrl: row.reminder?.whatsappUrl || null,
      errors: []
    };

    if (channel === 'email' || channel === 'all') {
      if (!row.contact?.email) {
        entry.emailSkipped = true;
        entry.errors.push('No parent email on file');
      } else {
        try {
          await sendFeePaymentReminder({
            to: row.contact.email,
            parentName: row.contact.name,
            studentName: row.studentName,
            admissionNumber: row.admissionNumber,
            amount: row.pendingAmount,
            riskCategory: row.riskCategory,
            latePaymentProbability: row.latePaymentProbability,
            bodyText: row.reminder.body
          });
          entry.emailSent = true;
        } catch (error) {
          entry.errors.push(error.message || 'Email failed');
        }
      }
    }

    if (channel === 'whatsapp' || channel === 'all') {
      if (!entry.whatsappUrl) entry.errors.push('No parent mobile on file for WhatsApp');
    }

    results.push(entry);

    logEntityUpdate({
      module: MODULE,
      entityId: row.studentId,
      entityLabel: row.studentName,
      action: 'fee_reminder_sent',
      description: `Fee reminder prepared (${channel}) for ${row.studentName}`,
      user: req.user,
      meta: {
        channel,
        emailSent: entry.emailSent,
        riskCategory: row.riskCategory,
        pendingAmount: row.pendingAmount
      }
    });
  }

  res.json({
    channel,
    sent: results.filter((r) => r.emailSent).length,
    whatsappReady: results.filter((r) => r.whatsappUrl).length,
    results
  });
});
