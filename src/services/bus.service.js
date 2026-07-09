const BusRoute = require('../models/BusRoute');
const BusRegistration = require('../models/BusRegistration');
const Student = require('../models/Student');
const ClassRoom = require('../models/ClassRoom');
const FeeInvoice = require('../models/FeeInvoice');
const { HTTP_STATUS } = require('../constants');
const { toYearMonth, monthInService, isPeriodOnOrAfter, validateDateRange } = require('../utils/effectivePeriod');
const { ensureAcademicYearEditable, assertHistoricalRegistrationImmutable } = require('./integrity.service');

function resolveBusFee(student, year, month) {
  const bus = student.busAssignment;
  if (!bus?.active || !bus.busService || bus.status === 'inactive') return 0;
  if (!monthInService(bus, year, month)) return 0;
  return Math.max(bus.monthlyFee || 0, 0);
}

function resolveStopFee(route, stopSequence, stopName) {
  if (route.feeType === 'fixed') {
    return Math.max(route.fixedMonthlyFee || 0, 0);
  }
  const stop = route.stops?.find(
    (item) => item.sequence === Number(stopSequence) || item.name === stopName
  );
  return Math.max(stop?.monthlyFee || 0, 0);
}

function normalizeStops(stops = []) {
  return [...stops]
    .map((stop, index) => ({
      name: String(stop.name || '').trim(),
      sequence: Number(stop.sequence) || index + 1,
      distance: Math.max(Number(stop.distance) || 0, 0),
      monthlyFee: Math.max(Number(stop.monthlyFee) || 0, 0)
    }))
    .filter((stop) => stop.name)
    .sort((a, b) => a.sequence - b.sequence);
}

async function countActiveRegistrations(routeId, excludeRegistrationId) {
  const filter = { route: routeId, status: 'active', busService: true };
  if (excludeRegistrationId) filter._id = { $ne: excludeRegistrationId };
  return BusRegistration.countDocuments(filter);
}

async function ensureRouteCapacity(route, excludeRegistrationId) {
  const assigned = await countActiveRegistrations(route._id, excludeRegistrationId);
  if (assigned >= route.capacity) {
    const error = new Error(`Route capacity reached (${route.capacity} students)`);
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'ROUTE_CAPACITY_FULL';
    throw error;
  }
}

async function ensureNoDuplicateRegistration(studentId, academicYearId, excludeId) {
  const existing = await BusRegistration.findOne({
    student: studentId,
    academicYear: academicYearId,
    status: 'active',
    busService: true,
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  });
  if (existing) {
    const error = new Error('Student already has an active bus registration for this academic year');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'DUPLICATE_BUS_REGISTRATION';
    throw error;
  }
}

function buildStudentBusAssignment(registration, route) {
  const active = registration.status === 'active' && registration.busService;
  return {
    active,
    busService: !!registration.busService && registration.status === 'active',
    registrationId: registration._id,
    route: route._id,
    routeName: route.routeName,
    routeCode: route.routeCode,
    stopName: registration.stopName,
    stopSequence: registration.stopSequence,
    monthlyFee: registration.monthlyFee,
    effectiveFrom: toYearMonth(registration.serviceStartDate),
    serviceStartDate: registration.serviceStartDate,
    serviceEndDate: registration.serviceEndDate || undefined,
    status: registration.status,
    busNumber: route.vehicleNumber,
    pickupPoint: registration.stopName,
    driverName: route.driverName,
    driverMobile: route.driverMobile
  };
}

async function syncStudentBusAssignment(registration, route, user) {
  const student = await Student.findById(registration.student);
  if (!student) return null;

  const isActive = registration.status === 'active' && registration.busService;
  if (isActive) {
    student.busAssignment = buildStudentBusAssignment(registration, route);
    student.activityLog = student.activityLog || [];
    student.activityLog.push({
      action: 'bus_assignment',
      description: `Bus assigned: ${route.routeName} — stop ${registration.stopName}`,
      performedBy: user?.email || user?.id || 'transport',
      performedAt: new Date(),
      meta: {
        routeName: route.routeName,
        stopName: registration.stopName,
        monthlyFee: registration.monthlyFee,
        status: registration.status
      }
    });
  } else {
    student.busAssignment = {
      ...student.busAssignment,
      active: false,
      busService: false,
      status: 'inactive',
      monthlyFee: 0,
      registrationId: registration._id
    };
    student.activityLog = student.activityLog || [];
    student.activityLog.push({
      action: 'bus_deactivate',
      description: `Bus service deactivated (${route.routeName})`,
      performedBy: user?.email || user?.id || 'transport',
      performedAt: new Date(),
      meta: { routeName: route.routeName, status: registration.status }
    });
  }

  await student.save();
  return student;
}

async function refreshOpenBusFeesForStudent(studentId, academicYearId, feeEffectiveFrom) {
  const student = await Student.findById(studentId);
  if (!student) return { updated: 0 };

  const invoices = await FeeInvoice.find({
    student: studentId,
    academicYear: academicYearId,
    status: { $in: ['unpaid', 'partial'] },
    locked: { $ne: true }
  });

  let updated = 0;
  for (const invoice of invoices) {
    if (feeEffectiveFrom && !isPeriodOnOrAfter(invoice.feeYear, invoice.feeMonth, feeEffectiveFrom)) {
      continue;
    }
    const busFee = resolveBusFee(student, invoice.feeYear, invoice.feeMonth);
    if (invoice.busFee !== busFee) {
      invoice.busFee = busFee;
      await invoice.save();
      updated += 1;
    }
  }

  return { updated };
}
async function enrichRoute(routeDoc) {
  const route = routeDoc.toObject ? routeDoc.toObject() : { ...routeDoc };
  const assignedCount = await countActiveRegistrations(route._id);
  return {
    ...route,
    assignedCount,
    availableCapacity: Math.max((route.capacity || 0) - assignedCount, 0)
  };
}

async function listRoutes(filter = {}) {
  const routes = await BusRoute.find(filter).sort({ routeName: 1 });
  return Promise.all(routes.map((route) => enrichRoute(route)));
}

async function createRoute(payload, user) {
  const stops = normalizeStops(payload.stops);
  if (!stops.length) {
    const error = new Error('At least one bus stop is required');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  const route = await BusRoute.create({
    routeName: payload.routeName,
    routeCode: String(payload.routeCode || '').trim().toUpperCase(),
    vehicleNumber: payload.vehicleNumber,
    driverName: payload.driverName,
    driverMobile: payload.driverMobile,
    status: payload.status || 'active',
    capacity: payload.capacity || 40,
    feeType: payload.feeType || 'stop_based',
    fixedMonthlyFee: payload.fixedMonthlyFee || 0,
    stops,
    createdBy: user?.id,
    updatedBy: user?.id
  });

  return enrichRoute(route);
}

async function updateRoute(routeId, payload, user) {
  const route = await BusRoute.findById(routeId);
  if (!route) {
    const error = new Error('Bus route not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }

  if (payload.routeName !== undefined) route.routeName = payload.routeName;
  if (payload.routeCode !== undefined) route.routeCode = String(payload.routeCode).trim().toUpperCase();
  if (payload.vehicleNumber !== undefined) route.vehicleNumber = payload.vehicleNumber;
  if (payload.driverName !== undefined) route.driverName = payload.driverName;
  if (payload.driverMobile !== undefined) route.driverMobile = payload.driverMobile;
  if (payload.capacity !== undefined) route.capacity = payload.capacity;
  if (payload.feeType !== undefined) route.feeType = payload.feeType;
  if (payload.fixedMonthlyFee !== undefined) route.fixedMonthlyFee = payload.fixedMonthlyFee;
  if (payload.stops !== undefined) {
    const stops = normalizeStops(payload.stops);
    if (!stops.length) {
      const error = new Error('At least one bus stop is required');
      error.status = HTTP_STATUS.BAD_REQUEST;
      throw error;
    }
    route.stops = stops;
  }
  route.updatedBy = user?.id;
  await route.save();
  return enrichRoute(route);
}

async function toggleRouteStatus(routeId, user) {
  const route = await BusRoute.findById(routeId);
  if (!route) {
    const error = new Error('Bus route not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }
  route.status = route.status === 'active' ? 'inactive' : 'active';
  route.updatedBy = user?.id;
  await route.save();
  return enrichRoute(route);
}

async function populateRegistration(id) {
  return BusRegistration.findById(id)
    .populate('student', 'firstName lastName admissionNumber status enrollments')
    .populate('academicYear', 'name status')
    .populate('route', 'routeName routeCode vehicleNumber driverName driverMobile status capacity feeType fixedMonthlyFee stops');
}

async function listRegistrations(filter = {}) {
  const registrations = await BusRegistration.find(filter)
    .populate('student', 'firstName lastName admissionNumber status enrollments')
    .populate('academicYear', 'name')
    .populate('route', 'routeName routeCode vehicleNumber status')
    .sort({ updatedAt: -1 });
  return registrations;
}

async function validateRegistrationInput(payload, existingId) {
  if (payload.serviceStartDate && payload.serviceEndDate) {
    const rangeError = validateDateRange(payload.serviceStartDate, payload.serviceEndDate);
    if (rangeError) {
      const error = new Error(rangeError);
      error.status = HTTP_STATUS.BAD_REQUEST;
      throw error;
    }
  }

  const student = await Student.findById(payload.student);
  if (!student) {
    const error = new Error('Student not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }
  if (student.status !== 'active') {
    const error = new Error('Only active students can use bus service');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  const route = await BusRoute.findById(payload.route);
  if (!route) {
    const error = new Error('Bus route not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }
  if (route.status !== 'active') {
    const error = new Error('Only active routes can be assigned');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  const stop = route.stops?.find(
    (item) => item.sequence === Number(payload.stopSequence) || item.name === payload.stopName
  );
  if (!stop) {
    const error = new Error('Selected stop does not exist on this route');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  const busService = payload.busService !== false;
  if (busService && payload.status !== 'inactive') {
    await ensureNoDuplicateRegistration(payload.student, payload.academicYear, existingId);
    await ensureRouteCapacity(route, existingId);
  }

  const monthlyFee = payload.monthlyFee != null
    ? Math.max(Number(payload.monthlyFee) || 0, 0)
    : resolveStopFee(route, stop.sequence, stop.name);

  return { student, route, stop, monthlyFee, busService };
}

async function createRegistration(payload, user) {
  await ensureAcademicYearEditable(payload.academicYear);
  const { student, route, stop, monthlyFee, busService } = await validateRegistrationInput(payload);

  const registration = await BusRegistration.create({
    student: payload.student,
    academicYear: payload.academicYear,
    route: route._id,
    stopName: stop.name,
    stopSequence: stop.sequence,
    monthlyFee,
    busService,
    serviceStartDate: new Date(payload.serviceStartDate),
    serviceEndDate: payload.serviceEndDate ? new Date(payload.serviceEndDate) : undefined,
    feeEffectiveFrom: payload.feeEffectiveFrom ? new Date(payload.feeEffectiveFrom) : new Date(payload.serviceStartDate),
    status: payload.status || 'active',
    createdBy: user?.id,
    updatedBy: user?.id
  });

  if (registration.status === 'active' && registration.busService) {
    await syncStudentBusAssignment(registration, route, user);
    await refreshOpenBusFeesForStudent(student._id, payload.academicYear);
  }

  return populateRegistration(registration._id);
}

async function updateRegistration(registrationId, payload, user) {
  const registration = await BusRegistration.findById(registrationId);
  if (!registration) {
    const error = new Error('Bus registration not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }

  assertHistoricalRegistrationImmutable(registration, {
    module: 'transport',
    entityId: registration._id,
    entityLabel: registration.stopName,
    user
  });

  const merged = {
    student: registration.student,
    academicYear: registration.academicYear,
    route: payload.route || registration.route,
    stopName: payload.stopName || registration.stopName,
    stopSequence: payload.stopSequence || registration.stopSequence,
    monthlyFee: payload.monthlyFee,
    busService: payload.busService !== undefined ? payload.busService : registration.busService,
    serviceStartDate: payload.serviceStartDate || registration.serviceStartDate,
    serviceEndDate: payload.serviceEndDate !== undefined ? payload.serviceEndDate : registration.serviceEndDate,
    status: payload.status || registration.status
  };

  const { route, stop, monthlyFee } = await validateRegistrationInput(merged, registrationId);

  const feeChanged = payload.monthlyFee != null && monthlyFee !== registration.monthlyFee;
  registration.route = route._id;
  registration.stopName = stop.name;
  registration.stopSequence = stop.sequence;
  registration.monthlyFee = monthlyFee;
  if (feeChanged) {
    registration.feeEffectiveFrom = payload.feeEffectiveFrom
      ? new Date(payload.feeEffectiveFrom)
      : new Date();
  }
  if (payload.busService !== undefined) registration.busService = payload.busService;
  if (payload.serviceStartDate) registration.serviceStartDate = new Date(payload.serviceStartDate);
  if (payload.serviceEndDate !== undefined) {
    registration.serviceEndDate = payload.serviceEndDate ? new Date(payload.serviceEndDate) : undefined;
  }
  if (payload.status) registration.status = payload.status;
  registration.updatedBy = user?.id;
  await registration.save();

  await syncStudentBusAssignment(registration, route, user);
  await refreshOpenBusFeesForStudent(
    registration.student,
    registration.academicYear,
    feeChanged ? registration.feeEffectiveFrom : undefined
  );
  return populateRegistration(registration._id);
}

async function deactivateRegistration(registrationId, user) {
  const registration = await BusRegistration.findById(registrationId);
  if (!registration) {
    const error = new Error('Bus registration not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }

  const route = await BusRoute.findById(registration.route);
  registration.status = 'inactive';
  registration.busService = false;
  registration.serviceEndDate = registration.serviceEndDate || new Date();
  registration.historicalLocked = true;
  registration.updatedBy = user?.id;
  await registration.save();

  if (route) {
    await syncStudentBusAssignment(registration, route, user);
  }
  await refreshOpenBusFeesForStudent(registration.student, registration.academicYear, new Date());
  return populateRegistration(registration._id);
}

async function buildReport(reportType, filters = {}) {
  const registrationFilter = {};
  if (filters.academicYear) registrationFilter.academicYear = filters.academicYear;
  if (filters.route) registrationFilter.route = filters.route;

  const registrations = await BusRegistration.find(registrationFilter)
    .populate('student', 'firstName lastName admissionNumber status enrollments')
    .populate('academicYear', 'name')
    .populate('route', 'routeName routeCode vehicleNumber capacity')
    .lean();

  const activeStudents = registrations.filter((row) => row.status === 'active' && row.busService);
  const inactiveStudents = registrations.filter((row) => row.status !== 'active' || !row.busService);

  if (reportType === 'active') {
    return activeStudents.map(formatReportRow);
  }
  if (reportType === 'inactive') {
    return inactiveStudents.map(formatReportRow);
  }
  if (reportType === 'route-wise') {
    return activeStudents.map(formatReportRow).sort((a, b) => a.routeName.localeCompare(b.routeName));
  }
  if (reportType === 'stop-wise') {
    return activeStudents
      .map(formatReportRow)
      .sort((a, b) => `${a.routeName}-${a.stopName}`.localeCompare(`${b.routeName}-${b.stopName}`));
  }
  if (reportType === 'bus-strength') {
    const grouped = new Map();
    for (const row of activeStudents) {
      const routeId = String(row.route?._id || row.route || 'unknown');
      const bucket = grouped.get(routeId) || {
        routeName: row.route?.routeName || '—',
        routeCode: row.route?.routeCode || '—',
        vehicleNumber: row.route?.vehicleNumber || '—',
        capacity: row.route?.capacity || 0,
        activeStudents: 0
      };
      bucket.activeStudents += 1;
      grouped.set(routeId, bucket);
    }
    return [...grouped.values()]
      .map((row) => ({
        ...row,
        availableSeats: Math.max((row.capacity || 0) - row.activeStudents, 0),
        occupancy: row.capacity ? Math.round((row.activeStudents / row.capacity) * 100) : 0
      }))
      .sort((a, b) => a.routeName.localeCompare(b.routeName));
  }

  if (reportType === 'fee-collection') {
    const invoiceFilter = { busFee: { $gt: 0 } };
    if (filters.academicYear) invoiceFilter.academicYear = filters.academicYear;
    const invoices = await FeeInvoice.find(invoiceFilter)
      .populate('student', 'firstName lastName admissionNumber')
      .populate('academicYear', 'name')
      .lean({ virtuals: true });

    return invoices.flatMap((invoice) => {
      const payments = (invoice.payments || []).filter((payment) => payment.status !== 'void');
      if (!payments.length) {
        return [{
          studentName: studentLabel(invoice.student),
          admissionNumber: invoice.student?.admissionNumber || '',
          academicYear: invoice.academicYear?.name || '',
          feeMonth: `${invoice.feeMonth}/${invoice.feeYear}`,
          busFee: invoice.busFee,
          paidAmount: 0,
          pendingAmount: invoice.balanceAmount,
          paymentDate: null,
          receiptNumber: null
        }];
      }
      return payments.map((payment) => ({
        studentName: studentLabel(invoice.student),
        admissionNumber: invoice.student?.admissionNumber || '',
        academicYear: invoice.academicYear?.name || '',
        feeMonth: `${invoice.feeMonth}/${invoice.feeYear}`,
        busFee: invoice.busFee,
        paidAmount: payment.amount,
        pendingAmount: invoice.balanceAmount,
        paymentDate: payment.paidAt,
        receiptNumber: payment.receiptNumber
      }));
    });
  }

  const error = new Error('Unknown report type');
  error.status = HTTP_STATUS.BAD_REQUEST;
  throw error;
}

function studentLabel(student) {
  if (!student) return '';
  return [student.firstName, student.lastName].filter(Boolean).join(' ');
}

function formatReportRow(row) {
  const enrollment = row.student?.enrollments?.[row.student.enrollments.length - 1];
  return {
    studentId: row.student?._id,
    studentName: studentLabel(row.student),
    admissionNumber: row.student?.admissionNumber || '',
    academicYear: row.academicYear?.name || '',
    classRoomId: enrollment?.classRoom,
    routeName: row.route?.routeName || '',
    routeCode: row.route?.routeCode || '',
    vehicleNumber: row.route?.vehicleNumber || '',
    stopName: row.stopName,
    monthlyFee: row.monthlyFee,
    serviceStartDate: row.serviceStartDate,
    serviceEndDate: row.serviceEndDate,
    status: row.status,
    busService: row.busService
  };
}

async function enrichRegistrationRows(rows) {
  const classIds = [...new Set(rows.map((row) => row.classRoomId).filter(Boolean))];
  const classes = classIds.length
    ? await ClassRoom.find({ _id: { $in: classIds } }).select('name section')
    : [];
  const classMap = Object.fromEntries(classes.map((room) => [room._id.toString(), `${room.name}-${room.section}`]));

  return rows.map((row) => ({
    ...row,
    className: row.classRoomId ? classMap[row.classRoomId.toString()] || '—' : '—'
  }));
}

module.exports = {
  resolveBusFee,
  resolveStopFee,
  normalizeStops,
  listRoutes,
  createRoute,
  updateRoute,
  toggleRouteStatus,
  enrichRoute,
  listRegistrations,
  createRegistration,
  updateRegistration,
  deactivateRegistration,
  refreshOpenBusFeesForStudent,
  buildReport,
  enrichRegistrationRows,
  populateRegistration
};
