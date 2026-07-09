const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const FeeInvoice = require('../models/FeeInvoice');
const Payroll = require('../models/Payroll');
const BusRegistration = require('../models/BusRegistration');
const BusRoute = require('../models/BusRoute');
const PromotionBatch = require('../models/PromotionBatch');
const ClassRoom = require('../models/ClassRoom');

const PRESENT_STATUSES = new Set(['present', 'late', 'half_day']);

function monthRange(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function previousMonths(count, fromDate = new Date()) {
  const points = [];
  const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    points.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }) });
  }
  return points;
}

async function monthlyAdmissionCount(year, month) {
  const range = monthRange(year, month);
  return Student.countDocuments({ admissionDate: { $gte: range.start, $lte: range.end } });
}

async function monthlyAttendanceRate(academicYearId, year, month) {
  const range = monthRange(year, month);
  const filter = { date: { $gte: range.start, $lte: range.end } };
  if (academicYearId) filter.academicYear = academicYearId;
  const records = await Attendance.find(filter).select('status').lean();
  if (!records.length) return 0;
  const present = records.filter((row) => PRESENT_STATUSES.has(row.status)).length;
  const countable = records.filter((row) => ['present', 'absent', 'leave', 'late', 'half_day'].includes(row.status)).length;
  return countable ? Math.round((present / countable) * 100) : 0;
}

async function monthlyFeeCollection(academicYearId, year, month) {
  const range = monthRange(year, month);
  const filter = { status: { $ne: 'cancelled' } };
  if (academicYearId) filter.academicYear = academicYearId;
  const invoices = await FeeInvoice.find(filter).lean({ virtuals: true });
  let collected = 0;
  for (const invoice of invoices) {
    for (const payment of invoice.payments || []) {
      if (payment.status === 'void' || !payment.paidAt) continue;
      const paidAt = new Date(payment.paidAt);
      if (paidAt >= range.start && paidAt <= range.end) collected += payment.amount || 0;
    }
  }
  return collected;
}

async function monthlyPayrollPaid(year, month) {
  const rows = await Payroll.find({ year, month, status: 'paid' }).select('netSalary').lean();
  return rows.reduce((sum, row) => sum + (row.netSalary || 0), 0);
}

async function monthlyPromotionCount(academicYearId, year, month) {
  const range = monthRange(year, month);
  const filter = { status: 'finalized', finalizedAt: { $gte: range.start, $lte: range.end } };
  if (academicYearId) filter.fromAcademicYear = academicYearId;
  const batches = await PromotionBatch.find(filter).select('promotedCount').lean();
  return batches.reduce((sum, batch) => sum + (batch.promotedCount || 0), 0);
}

async function monthlyBusUtilization(academicYearId, year, month) {
  const range = monthRange(year, month);
  const filter = {
    busService: true,
    status: 'active',
    serviceStartDate: { $lte: range.end },
    $or: [{ serviceEndDate: null }, { serviceEndDate: { $gte: range.start } }]
  };
  if (academicYearId) filter.academicYear = academicYearId;
  const [activeStudents, routes] = await Promise.all([
    BusRegistration.countDocuments(filter),
    BusRoute.find({ status: 'active' }).select('capacity').lean()
  ]);
  const capacity = routes.reduce((sum, route) => sum + (route.capacity || 0), 0);
  return {
    activeStudents,
    capacity,
    utilization: capacity > 0 ? Math.round((activeStudents / capacity) * 100) : (activeStudents > 0 ? 100 : 0)
  };
}

function trendDirection(current, previous, higherIsBetter = true) {
  const diff = current - previous;
  if (Math.abs(diff) <= (higherIsBetter ? 2 : 1)) return 'stable';
  if (higherIsBetter) return diff > 0 ? 'improved' : 'declined';
  return diff < 0 ? 'improved' : 'declined';
}

async function buildDashboardTrends(activeYear) {
  const yearId = activeYear?._id;
  const months = previousMonths(6);
  const [
    admissions,
    attendance,
    feeCollection,
    payroll,
    promotions,
    busUtilization
  ] = await Promise.all([
    Promise.all(months.map((point) => monthlyAdmissionCount(point.year, point.month))),
    Promise.all(months.map((point) => monthlyAttendanceRate(yearId, point.year, point.month))),
    Promise.all(months.map((point) => monthlyFeeCollection(yearId, point.year, point.month))),
    Promise.all(months.map((point) => monthlyPayrollPaid(point.year, point.month))),
    Promise.all(months.map((point) => monthlyPromotionCount(yearId, point.year, point.month))),
    Promise.all(months.map((point) => monthlyBusUtilization(yearId, point.year, point.month)))
  ]);

  const series = (metric, values, higherIsBetter = true) => {
    const current = values[values.length - 1] || 0;
    const previous = values[values.length - 2] || 0;
    return {
      metric,
      points: months.map((point, index) => ({
        label: point.label,
        value: typeof values[index] === 'object' ? values[index].utilization : values[index]
      })),
      currentValue: typeof current === 'object' ? current.utilization : current,
      previousValue: typeof previous === 'object' ? previous.utilization : previous,
      trend: trendDirection(
        typeof current === 'object' ? current.utilization : current,
        typeof previous === 'object' ? previous.utilization : previous,
        higherIsBetter
      )
    };
  };

  return {
    generatedAt: new Date(),
    admissions: series('admissions', admissions),
    attendance: series('attendance', attendance),
    feeCollection: series('fee_collection', feeCollection),
    payroll: series('payroll', payroll),
    promotions: series('promotions', promotions),
    busUtilization: series('bus_utilization', busUtilization.map((row) => row.utilization), true)
  };
}

module.exports = { buildDashboardTrends };
