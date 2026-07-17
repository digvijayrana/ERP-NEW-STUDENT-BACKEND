/**
 * AI Fee Prediction — rule-based prediction engine.
 *
 * Uses payment history, overdue patterns, and carry-forward balances to estimate:
 *  - Late payment probability
 *  - Default (non-payment) probability
 *  - Expected collection & monthly revenue
 *  - Risk category (low | medium | high | critical)
 *
 * Reminder helpers generate email / WhatsApp / in-app parent reminder payloads.
 */
const FeeInvoice = require('../models/FeeInvoice');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const ClassRoom = require('../models/ClassRoom');
const { createLogger } = require('../utils/logger');

const log = createLogger('fee-prediction');

const MONTH_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function daysBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function studentDisplayName(student) {
  return [student?.firstName, student?.middleName, student?.lastName].filter(Boolean).join(' ').trim() || 'Student';
}

function classLabel(classRoom) {
  if (!classRoom) return '—';
  if (typeof classRoom === 'string') return classRoom;
  return `${classRoom.name || ''}${classRoom.section ? `-${classRoom.section}` : ''}`.trim() || '—';
}

function riskCategory(defaultProbability) {
  if (defaultProbability >= 75) return 'critical';
  if (defaultProbability >= 50) return 'high';
  if (defaultProbability >= 25) return 'medium';
  return 'low';
}

/**
 * Score one student's invoices into prediction metrics.
 */
function scoreStudent(student, invoices, now = new Date()) {
  const open = invoices.filter((inv) => ['unpaid', 'partial'].includes(inv.status));
  const overdue = open.filter((inv) => inv.dueDate && new Date(inv.dueDate) < now);
  const paid = invoices.filter((inv) => inv.status === 'paid' || (inv.paidAmount || 0) > 0);

  let latePayments = 0;
  let onTimePayments = 0;
  let totalPaymentLatency = 0;
  let latencySamples = 0;

  for (const inv of invoices) {
    const activePayments = (inv.payments || []).filter((p) => p.status !== 'void');
    if (!activePayments.length || !inv.dueDate) continue;
    const lastPaid = activePayments.reduce((latest, p) => {
      const at = new Date(p.paidAt);
      return !latest || at > latest ? at : latest;
    }, null);
    if (!lastPaid) continue;
    const lag = daysBetween(inv.dueDate, lastPaid);
    latencySamples += 1;
    totalPaymentLatency += Math.max(lag, 0);
    if (lag > 0) latePayments += 1;
    else onTimePayments += 1;
  }

  const pendingAmount = open.reduce((sum, inv) => sum + (inv.balanceAmount || 0), 0);
  const overdueAmount = overdue.reduce((sum, inv) => sum + (inv.balanceAmount || 0), 0);
  const collectedAmount = invoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
  const billedAmount = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

  const lateRate = latencySamples ? latePayments / latencySamples : open.length ? 0.4 : 0;
  const avgLatencyDays = latencySamples ? totalPaymentLatency / latencySamples : overdue.length ? 15 : 0;
  const overdueRatio = invoices.length ? overdue.length / invoices.length : 0;
  const pendingRatio = billedAmount > 0 ? pendingAmount / billedAmount : open.length ? 1 : 0;
  const consecutiveOverdue = overdue.length;
  const carryForward = invoices.reduce((sum, inv) => sum + (inv.previousPending || 0), 0);

  // Late payment probability — leans on historical lateness + current overdue pressure.
  let latePaymentProbability = 12;
  latePaymentProbability += lateRate * 45;
  latePaymentProbability += Math.min(avgLatencyDays, 60) * 0.35;
  latePaymentProbability += overdueRatio * 25;
  latePaymentProbability += Math.min(consecutiveOverdue, 6) * 4;
  if (open.some((inv) => inv.status === 'partial')) latePaymentProbability += 8;
  latePaymentProbability = clamp(latePaymentProbability);

  // Default probability — risk of leaving outstanding unpaid for the long term.
  let defaultProbability = 8;
  defaultProbability += overdueRatio * 40;
  defaultProbability += pendingRatio * 30;
  defaultProbability += Math.min(consecutiveOverdue, 6) * 5;
  defaultProbability += carryForward > 0 ? Math.min(carryForward / 1000, 12) : 0;
  if (collectedAmount === 0 && pendingAmount > 0) defaultProbability += 18;
  if (lateRate > 0.6) defaultProbability += 10;
  defaultProbability = clamp(defaultProbability);

  const collectionLikelihood = (100 - defaultProbability) / 100;
  const expectedCollection = Math.round(pendingAmount * collectionLikelihood);
  const category = riskCategory(defaultProbability);

  const maxOverdueDays = overdue.reduce((max, inv) => {
    const days = daysBetween(inv.dueDate, now);
    return days > max ? days : max;
  }, 0);

  return {
    studentId: String(student._id),
    studentName: studentDisplayName(student),
    admissionNumber: student.admissionNumber || '',
    classLabel: classLabel(
      open[0]?.classRoom ||
        paid[0]?.classRoom ||
        invoices[0]?.classRoom
    ),
    pendingAmount: Math.round(pendingAmount),
    overdueAmount: Math.round(overdueAmount),
    collectedAmount: Math.round(collectedAmount),
    overdueInvoices: overdue.length,
    openInvoices: open.length,
    latePaymentProbability,
    defaultProbability,
    expectedCollection,
    riskCategory: category,
    avgPaymentLatencyDays: Math.round(avgLatencyDays),
    maxOverdueDays,
    latePaymentCount: latePayments,
    onTimePaymentCount: onTimePayments,
    factors: buildFactors({
      overdue: overdue.length,
      lateRate,
      avgLatencyDays,
      pendingAmount,
      carryForward,
      consecutiveOverdue
    })
  };
}

function buildFactors({ overdue, lateRate, avgLatencyDays, pendingAmount, carryForward, consecutiveOverdue }) {
  const factors = [];
  if (overdue > 0) factors.push(`${overdue} overdue invoice${overdue > 1 ? 's' : ''}`);
  if (lateRate >= 0.4) factors.push(`${Math.round(lateRate * 100)}% historical late payments`);
  if (avgLatencyDays >= 7) factors.push(`Avg delay ${Math.round(avgLatencyDays)} days`);
  if (pendingAmount > 0) factors.push(`Pending ₹${Math.round(pendingAmount).toLocaleString('en-IN')}`);
  if (carryForward > 0) factors.push('Prior carry-forward balance');
  if (consecutiveOverdue >= 3) factors.push('Repeated overdue months');
  return factors.length ? factors : ['Healthy payment pattern'];
}

function resolveContact(student, parentDoc) {
  const guardian = (student.guardians || [])[0] || {};
  const phone = parentDoc?.phone || guardian.phone || '';
  const email = parentDoc?.email || guardian.email || '';
  const name = parentDoc?.name || guardian.name || 'Parent / Guardian';
  return { phone: String(phone || '').replace(/\D/g, ''), email: String(email || '').trim(), name };
}

function buildReminderMessage(prediction, schoolName = 'School') {
  const amount = prediction.pendingAmount || 0;
  const risk = (prediction.riskCategory || 'medium').toUpperCase();
  return {
    subject: `Fee payment reminder — ${prediction.studentName}`,
    body:
      `Dear Parent / Guardian,\n\n` +
      `This is a gentle reminder from ${schoolName} regarding pending fee for ` +
      `${prediction.studentName}${prediction.admissionNumber ? ` (${prediction.admissionNumber})` : ''}.\n\n` +
      `Outstanding amount: ₹${amount.toLocaleString('en-IN')}\n` +
      `Risk category: ${risk}\n` +
      `Late payment likelihood: ${prediction.latePaymentProbability}%\n\n` +
      `Please clear the dues at the earliest to avoid late charges.\n\n` +
      `Thank you,\n${schoolName}`
  };
}

function whatsappLink(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
}

/**
 * Load active studying students (optionally filtered) with their invoices.
 */
async function loadPredictionUniverse({ academicYear, classRoom, riskOnly } = {}) {
  const studentFilter = { studentStatus: { $ne: 'left' } };
  if (academicYear) {
    studentFilter.enrollments = {
      $elemMatch: { academicYear, status: 'studying' }
    };
  }

  const students = await Student.find(studentFilter)
    .select('firstName middleName lastName admissionNumber guardians parent enrollments')
    .lean();

  let studentIds = students.map((s) => s._id);
  if (classRoom) {
    const invoiceStudentIds = await FeeInvoice.distinct('student', {
      classRoom,
      status: { $ne: 'cancelled' },
      ...(academicYear ? { academicYear } : {})
    });
    const allowed = new Set(invoiceStudentIds.map(String));
    studentIds = studentIds.filter((id) => allowed.has(String(id)));
  }

  const invoiceFilter = {
    student: { $in: studentIds },
    status: { $ne: 'cancelled' }
  };
  if (academicYear) invoiceFilter.academicYear = academicYear;
  if (classRoom) invoiceFilter.classRoom = classRoom;

  const invoices = await FeeInvoice.find(invoiceFilter)
    .populate('classRoom', 'name section')
    .lean({ virtuals: true });

  const byStudent = new Map();
  for (const inv of invoices) {
    const key = String(inv.student);
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(inv);
  }

  const parentIds = students.map((s) => s.parent).filter(Boolean);
  const parents = parentIds.length
    ? await Parent.find({ _id: { $in: parentIds } }).select('name phone email children').lean()
    : [];
  const parentById = new Map(parents.map((p) => [String(p._id), p]));

  const now = new Date();
  const predictions = [];
  for (const student of students) {
    if (!studentIds.some((id) => String(id) === String(student._id))) continue;
    const rows = byStudent.get(String(student._id)) || [];
    if (!rows.length && riskOnly) continue;
    const scored = scoreStudent(student, rows, now);
    if (riskOnly && scored.riskCategory === 'low' && scored.pendingAmount <= 0) continue;
    const contact = resolveContact(student, parentById.get(String(student.parent || '')));
    predictions.push({ ...scored, contact });
  }

  predictions.sort((a, b) => b.defaultProbability - a.defaultProbability || b.pendingAmount - a.pendingAmount);
  return predictions;
}

/**
 * Payment trend for the last N months (billed vs collected).
 */
async function buildPaymentTrend(months = 6, academicYear) {
  const now = new Date();
  const points = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const filter = { feeYear: year, feeMonth: month, status: { $ne: 'cancelled' } };
    if (academicYear) filter.academicYear = academicYear;

    const invoices = await FeeInvoice.find(filter).lean({ virtuals: true });
    const billed = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
    const collected = invoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
    const pending = invoices.reduce((sum, inv) => sum + (inv.balanceAmount || 0), 0);
    const overdue = invoices.filter(
      (inv) => (inv.balanceAmount || 0) > 0 && inv.dueDate && new Date(inv.dueDate) < now
    ).length;

    points.push({
      year,
      month,
      label: `${MONTH_LABELS[month]} ${String(year).slice(2)}`,
      billed: Math.round(billed),
      collected: Math.round(collected),
      pending: Math.round(pending),
      overdueCount: overdue,
      collectionRate: billed > 0 ? Math.round((collected / billed) * 100) : 0
    });
  }
  return points;
}

/**
 * Forecast next-month revenue from recent collection average + expected collection on open dues.
 */
function forecastMonthlyRevenue(trend, predictions) {
  const recent = trend.slice(-3);
  const avgCollected = recent.length
    ? recent.reduce((sum, p) => sum + p.collected, 0) / recent.length
    : 0;
  const expectedFromOpen = predictions.reduce((sum, p) => sum + (p.expectedCollection || 0), 0);
  // Blend steady collection pace with predictive recovery of open dues (weighted).
  return Math.round(avgCollected * 0.65 + expectedFromOpen * 0.35);
}

async function buildDashboard({ academicYear, classRoom } = {}) {
  const [predictions, trend] = await Promise.all([
    loadPredictionUniverse({ academicYear, classRoom }),
    buildPaymentTrend(6, academicYear)
  ]);

  const withPending = predictions.filter((p) => p.pendingAmount > 0);
  const overdueRisk = predictions.filter((p) => p.overdueInvoices > 0 || p.latePaymentProbability >= 50);
  const defaulters = predictions.filter((p) => p.riskCategory === 'high' || p.riskCategory === 'critical');

  const totalPending = withPending.reduce((sum, p) => sum + p.pendingAmount, 0);
  const expectedCollection = withPending.reduce((sum, p) => sum + p.expectedCollection, 0);
  const avgDefaultProbability = withPending.length
    ? Math.round(withPending.reduce((sum, p) => sum + p.defaultProbability, 0) / withPending.length)
    : 0;
  const avgLateProbability = withPending.length
    ? Math.round(withPending.reduce((sum, p) => sum + p.latePaymentProbability, 0) / withPending.length)
    : 0;

  const riskBreakdown = {
    low: predictions.filter((p) => p.riskCategory === 'low').length,
    medium: predictions.filter((p) => p.riskCategory === 'medium').length,
    high: predictions.filter((p) => p.riskCategory === 'high').length,
    critical: predictions.filter((p) => p.riskCategory === 'critical').length
  };

  const monthlyRevenue = forecastMonthlyRevenue(trend, withPending);
  const lastMonth = trend[trend.length - 1];

  log.info('Fee prediction dashboard built', {
    students: predictions.length,
    pending: totalPending,
    expectedCollection
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      studentsAnalyzed: predictions.length,
      studentsWithPending: withPending.length,
      latePaymentRiskCount: overdueRisk.length,
      defaulterRiskCount: defaulters.length,
      totalPending,
      expectedCollection,
      monthlyRevenueForecast: monthlyRevenue,
      avgLatePaymentProbability: avgLateProbability,
      avgDefaultProbability,
      lastMonthCollected: lastMonth?.collected || 0,
      lastMonthBilled: lastMonth?.billed || 0,
      lastMonthCollectionRate: lastMonth?.collectionRate || 0
    },
    riskBreakdown,
    paymentTrend: trend,
    highRiskStudents: predictions
      .filter((p) => p.pendingAmount > 0 && (p.riskCategory === 'high' || p.riskCategory === 'critical'))
      .slice(0, 50),
    predictions: predictions.filter((p) => p.pendingAmount > 0).slice(0, 200)
  };
}

async function buildReminders(studentIds = []) {
  const ids = (studentIds || []).map(String).filter(Boolean);
  if (!ids.length) return [];

  const students = await Student.find({ _id: { $in: ids } })
    .select('firstName middleName lastName admissionNumber guardians parent')
    .lean();
  const invoices = await FeeInvoice.find({
    student: { $in: ids },
    status: { $in: ['unpaid', 'partial'] }
  })
    .populate('classRoom', 'name section')
    .lean({ virtuals: true });

  const byStudent = new Map();
  for (const inv of invoices) {
    const key = String(inv.student);
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(inv);
  }

  const parentIds = students.map((s) => s.parent).filter(Boolean);
  const parents = parentIds.length
    ? await Parent.find({ _id: { $in: parentIds } }).select('name phone email').lean()
    : [];
  const parentById = new Map(parents.map((p) => [String(p._id), p]));

  let schoolName = process.env.SCHOOL_NAME || 'School';
  try {
    const { getCachedSchoolBranding } = require('./governanceConfig.service');
    schoolName = getCachedSchoolBranding()?.name || schoolName;
  } catch {
    /* optional branding */
  }

  const now = new Date();
  return students.map((student) => {
    const rows = byStudent.get(String(student._id)) || [];
    const prediction = scoreStudent(student, rows, now);
    const contact = resolveContact(student, parentById.get(String(student.parent || '')));
    const message = buildReminderMessage(prediction, schoolName);
    return {
      ...prediction,
      contact,
      reminder: {
        subject: message.subject,
        body: message.body,
        emailReady: !!contact.email,
        whatsappReady: !!(contact.phone && contact.phone.length >= 10),
        whatsappUrl: whatsappLink(contact.phone, message.body),
        channels: [
          contact.email ? 'email' : null,
          contact.phone && contact.phone.length >= 10 ? 'whatsapp' : null,
          'parent_portal'
        ].filter(Boolean)
      }
    };
  });
}

module.exports = {
  buildDashboard,
  loadPredictionUniverse,
  buildPaymentTrend,
  buildReminders,
  scoreStudent,
  riskCategory,
  whatsappLink,
  buildReminderMessage
};
