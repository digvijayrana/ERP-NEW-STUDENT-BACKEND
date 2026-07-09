const Activity = require('../models/Activity');
const Attendance = require('../models/Attendance');
const BusRegistration = require('../models/BusRegistration');
const FeeInvoice = require('../models/FeeInvoice');
const { studentAttendanceSummary } = require('./attendance.service');
const { resolveTuitionFee } = require('./fee.service');

const TIMELINE_LIMIT = 40;

function invoicePaidAmount(invoice) {
  if (invoice.paidAmount != null) return invoice.paidAmount;
  return (invoice.payments || [])
    .filter((payment) => payment.status !== 'void')
    .reduce((sum, payment) => sum + (payment.amount || 0), 0);
}

function invoiceTotalAmount(invoice) {
  if (invoice.totalAmount != null) return invoice.totalAmount;
  return (
    (invoice.tuitionFee || 0) +
    (invoice.busFee || 0) +
    (invoice.otherCharges || 0) +
    (invoice.previousPending || 0) +
    (invoice.fine || 0) -
    (invoice.discount || 0)
  );
}

function invoiceBalanceAmount(invoice) {
  if (invoice.balanceAmount != null) return invoice.balanceAmount;
  return Math.max(invoiceTotalAmount(invoice) - invoicePaidAmount(invoice), 0);
}

function formatStatusLabel(status) {
  return String(status || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function loadActiveTransport(student, academicYearId) {
  const filter = {
    student: student._id,
    status: 'active',
    busService: true
  };
  if (academicYearId) filter.academicYear = academicYearId;

  const registration = await BusRegistration.findOne(filter)
    .populate('route', 'routeName routeCode vehicleNumber driverName driverMobile status')
    .sort({ updatedAt: -1 })
    .lean();

  if (registration) {
    return {
      assigned: true,
      route: registration.route?.routeName || '—',
      busStop: registration.stopName || '—',
      pickupPoint: registration.stopName || '—',
      busNumber: registration.route?.vehicleNumber || registration.route?.routeCode || '—',
      monthlyFee: registration.monthlyFee || 0,
      status: registration.status === 'active' ? 'active' : 'inactive',
      serviceStartDate: registration.serviceStartDate,
      serviceEndDate: registration.serviceEndDate,
      driverName: registration.route?.driverName || '—',
      driverMobile: registration.route?.driverMobile || '—',
      registrationId: registration._id
    };
  }

  const assignment = student.busAssignment;
  if (assignment?.active && assignment?.busService !== false) {
    return {
      assigned: true,
      route: assignment.routeName || '—',
      busStop: assignment.stopName || assignment.pickupPoint || '—',
      pickupPoint: assignment.stopName || assignment.pickupPoint || '—',
      busNumber: assignment.busNumber || assignment.routeCode || '—',
      monthlyFee: assignment.monthlyFee || 0,
      status: assignment.status === 'inactive' ? 'inactive' : 'active',
      serviceStartDate: assignment.serviceStartDate,
      serviceEndDate: assignment.serviceEndDate,
      driverName: assignment.driverName || '—',
      driverMobile: assignment.driverMobile || '—',
      registrationId: assignment.registrationId || null
    };
  }

  return {
    assigned: false,
    route: 'Not assigned',
    busStop: '—',
    pickupPoint: '—',
    busNumber: '—',
    monthlyFee: 0,
    status: 'inactive',
    serviceStartDate: null,
    serviceEndDate: null,
    driverName: '—',
    driverMobile: '—',
    registrationId: null
  };
}

async function buildTransportCard(student, academicYearId) {
  return loadActiveTransport(student, academicYearId);
}

async function buildAttendanceCard(studentId, academicYearId) {
  return studentAttendanceSummary(studentId, academicYearId);
}

async function buildFeeSummary(student, academicYearId, classRoomId, invoices) {
  const activeInvoices = invoices.filter((inv) => inv.status !== 'cancelled');
  const totalDue = activeInvoices.reduce((sum, inv) => sum + invoiceBalanceAmount(inv), 0);
  const totalPaid = activeInvoices.reduce((sum, inv) => sum + invoicePaidAmount(inv), 0);
  const feeStatus = totalDue <= 0 ? 'paid' : activeInvoices.some((i) => i.status === 'partial') ? 'partial' : 'unpaid';

  const monthlyFee = academicYearId && classRoomId
    ? await resolveTuitionFee(student, academicYearId, classRoomId)
    : (activeInvoices[0]?.tuitionFee || 0);

  const latestInvoice = activeInvoices[0];
  const busFee = student.busAssignment?.active
    ? (student.busAssignment.monthlyFee || latestInvoice?.busFee || 0)
    : (latestInvoice?.busFee || 0);

  let lastReceipt = null;
  for (const invoice of activeInvoices) {
    for (const payment of invoice.payments || []) {
      if (payment.status === 'void' || !payment.paidAt) continue;
      if (!lastReceipt || new Date(payment.paidAt) > new Date(lastReceipt.paidAt)) {
        lastReceipt = {
          receiptNumber: payment.receiptNumber,
          amount: payment.amount,
          paidAt: payment.paidAt,
          mode: payment.mode,
          invoiceNumber: invoice.invoiceNumber
        };
      }
    }
  }

  return {
    status: feeStatus,
    monthlyFee,
    busFee,
    totalDue,
    totalPaid,
    pendingAmount: totalDue,
    lastReceipt,
    invoices: activeInvoices.slice(0, 20).map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      balanceAmount: invoiceBalanceAmount(inv),
      totalAmount: invoiceTotalAmount(inv),
      tuitionFee: inv.tuitionFee,
      busFee: inv.busFee,
      dueDate: inv.dueDate,
      feeMonth: inv.feeMonth,
      feeYear: inv.feeYear
    }))
  };
}

function mapStudentLogEntry(entry) {
  return {
    action: entry.action,
    description: entry.description,
    performedBy: entry.performedBy,
    performedAt: entry.performedAt,
    previousStatus: entry.meta?.previousStatus,
    newStatus: entry.meta?.newStatus,
    remarks: entry.meta?.remarks,
    source: 'student'
  };
}

function buildFeeTimelineEntries(invoices) {
  const entries = [];
  for (const invoice of invoices) {
    for (const payment of invoice.payments || []) {
      if (payment.status === 'void') continue;
      entries.push({
        action: 'fee_payment',
        description: `Fee payment: ${payment.receiptNumber} — ₹${payment.amount} (${invoice.invoiceNumber})`,
        performedBy: 'Accounts',
        performedAt: payment.paidAt || invoice.updatedAt,
        source: 'fees',
        meta: {
          receiptNumber: payment.receiptNumber,
          amount: payment.amount,
          invoiceNumber: invoice.invoiceNumber,
          mode: payment.mode
        }
      });
    }
  }
  return entries;
}

function buildBusTimelineEntries(registrations) {
  return registrations.map((registration) => {
    const routeName = registration.route?.routeName || 'route';
    const isInactive = registration.status === 'inactive' || registration.busService === false;
    return {
      action: isInactive ? 'bus_deactivate' : 'bus_assignment',
      description: isInactive
        ? `Bus service deactivated (${routeName})`
        : `Bus assigned: ${routeName} — stop ${registration.stopName}`,
      performedBy: registration.updatedBy || registration.createdBy || 'Transport office',
      performedAt: registration.updatedAt || registration.createdAt,
      source: 'transport',
      meta: {
        routeName,
        stopName: registration.stopName,
        monthlyFee: registration.monthlyFee,
        status: registration.status
      }
    };
  });
}

function buildAttendanceTimelineEntries(records) {
  return records.slice(0, 20).map((record) => ({
    action: 'attendance_update',
    description: `Attendance recorded: ${new Date(record.date).toLocaleDateString('en-IN')} — ${formatStatusLabel(record.status)}`,
    performedBy: record.markedBy ? 'Class teacher' : 'System',
    performedAt: record.updatedAt || record.date,
    source: 'attendance',
    meta: { status: record.status, date: record.date }
  }));
}

function mapGlobalActivityEntry(entry) {
  return {
    action: entry.action,
    description: entry.description,
    performedBy: entry.performedBy?.email || entry.performedBy?.name || 'System',
    performedAt: entry.performedAt,
    previousStatus: entry.meta?.previousStatus,
    newStatus: entry.meta?.newStatus,
    remarks: entry.meta?.remarks,
    source: entry.module
  };
}

async function buildActivityTimeline(student, invoices, academicYearId) {
  const [busRegistrations, attendanceRecords, globalActivities] = await Promise.all([
    BusRegistration.find({ student: student._id })
      .populate('route', 'routeName')
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean(),
    Attendance.find({
      student: student._id,
      ...(academicYearId ? { academicYear: academicYearId } : {})
    })
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean(),
    Activity.find({
      $or: [
        { module: 'students', entityId: student._id },
        { module: 'fees', entityId: { $in: invoices.map((inv) => inv._id) } },
        { entityLabel: student.admissionNumber },
        { 'meta.student': student._id },
        { 'meta.studentId': student._id }
      ]
    })
      .sort({ performedAt: -1 })
      .limit(30)
      .lean()
  ]);

  const merged = [
    ...(student.activityLog || []).map(mapStudentLogEntry),
    ...buildFeeTimelineEntries(invoices),
    ...buildBusTimelineEntries(busRegistrations),
    ...buildAttendanceTimelineEntries(attendanceRecords),
    ...globalActivities.map(mapGlobalActivityEntry)
  ];

  const seen = new Set();
  return merged
    .filter((entry) => {
      const key = `${entry.action}|${entry.description}|${new Date(entry.performedAt).toISOString()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt))
    .slice(0, TIMELINE_LIMIT);
}

module.exports = {
  buildTransportCard,
  buildAttendanceCard,
  buildFeeSummary,
  buildActivityTimeline
};
