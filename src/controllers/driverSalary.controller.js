const DriverSalaryPayment = require('../models/DriverSalaryPayment');
const Vehicle = require('../models/Vehicle');
const asyncHandler = require('../middleware/asyncHandler');
const { auditOnCreate } = require('../utils/auditFields');
const { logEntityCreate, logEntityUpdate } = require('../services/activityLog.service');
const { HTTP_STATUS } = require('../constants');

const MODULE = 'transport';

function currentPeriod() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

// Salary register for a month: every active vehicle with its payment status for that period.
exports.register = asyncHandler(async (req, res) => {
  const period = currentPeriod();
  const month = Number(req.query.month) || period.month;
  const year = Number(req.query.year) || period.year;

  const vehicles = await Vehicle.find({ status: 'active' }).sort({ vehicleNumber: 1 });
  const payments = await DriverSalaryPayment.find({
    vehicle: { $in: vehicles.map((v) => v._id) },
    month,
    year
  });
  const paymentByVehicle = new Map(payments.map((p) => [String(p.vehicle), p]));

  const rows = vehicles.map((vehicle) => {
    const payment = paymentByVehicle.get(String(vehicle._id));
    return {
      vehicle: vehicle._id,
      vehicleNumber: vehicle.vehicleNumber,
      driverName: vehicle.driverName || '',
      driverMobile: vehicle.driverMobile || '',
      salaryAmount: vehicle.driverSalary || 0,
      status: payment ? 'paid' : 'unpaid',
      payment: payment || null
    };
  });

  const totals = {
    month,
    year,
    drivers: rows.length,
    paidCount: rows.filter((r) => r.status === 'paid').length,
    unpaidCount: rows.filter((r) => r.status === 'unpaid').length,
    paidAmount: rows.filter((r) => r.status === 'paid').reduce((sum, r) => sum + (r.payment?.amount || 0), 0),
    pendingAmount: rows.filter((r) => r.status === 'unpaid').reduce((sum, r) => sum + (r.salaryAmount || 0), 0)
  };

  return res.json({ month, year, totals, rows });
});

// Payment history (optionally filtered by vehicle / year).
exports.history = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.vehicle) filter.vehicle = req.query.vehicle;
  if (req.query.year) filter.year = Number(req.query.year);
  if (req.query.month) filter.month = Number(req.query.month);

  const payments = await DriverSalaryPayment.find(filter)
    .populate('vehicle', 'vehicleNumber driverName driverMobile')
    .sort({ year: -1, month: -1, createdAt: -1 });
  return res.json({ data: payments });
});

exports.pay = asyncHandler(async (req, res) => {
  const { vehicle: vehicleId, month, year } = req.body;
  if (!vehicleId || !month || !year) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Vehicle, month and year are required' });
  }

  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Vehicle not found' });

  const existing = await DriverSalaryPayment.findOne({ vehicle: vehicleId, month: Number(month), year: Number(year) });
  if (existing) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Salary for this driver and month is already recorded' });
  }

  const amount = req.body.amount != null ? Math.max(Number(req.body.amount) || 0, 0) : (vehicle.driverSalary || 0);
  const payment = await DriverSalaryPayment.create({
    vehicle: vehicleId,
    driverName: vehicle.driverName || '',
    month: Number(month),
    year: Number(year),
    amount,
    mode: req.body.mode || 'cash',
    referenceNumber: req.body.referenceNumber || '',
    paidOn: req.body.paidOn ? new Date(req.body.paidOn) : new Date(),
    notes: req.body.notes || '',
    ...auditOnCreate(req.user)
  });

  logEntityCreate({
    module: MODULE,
    entityId: payment._id,
    entityLabel: vehicle.vehicleNumber,
    action: 'driver_salary_paid',
    description: `Driver salary paid: ${vehicle.driverName || vehicle.vehicleNumber} (${month}/${year}) — ${amount}`,
    user: req.user,
    meta: { vehicle: vehicleId, month, year, amount }
  });

  return res.status(HTTP_STATUS.CREATED).json(payment);
});

exports.remove = asyncHandler(async (req, res) => {
  const payment = await DriverSalaryPayment.findById(req.params.id);
  if (!payment) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Salary payment not found' });
  // Hard delete so the month can be re-recorded (unique index on vehicle+month+year).
  await DriverSalaryPayment.deleteOne({ _id: payment._id });

  logEntityUpdate({
    module: MODULE,
    entityId: payment._id,
    entityLabel: payment.driverName,
    action: 'driver_salary_reverted',
    description: `Driver salary payment reverted (${payment.month}/${payment.year})`,
    user: req.user,
    meta: { vehicle: payment.vehicle, month: payment.month, year: payment.year }
  });

  return res.json({ deleted: true });
});
