const BusRoute = require('../models/BusRoute');
const BusRegistration = require('../models/BusRegistration');
const Student = require('../models/Student');
const asyncHandler = require('../middleware/asyncHandler');
const {
  listRoutes,
  createRoute,
  updateRoute,
  toggleRouteStatus,
  listRegistrations,
  createRegistration,
  updateRegistration,
  deactivateRegistration,
  buildReport,
  enrichRegistrationRows,
  populateRegistration,
  enrichRoute
} = require('../services/bus.service');
const { transportReportPdf } = require('../services/pdf.service');
const { logEntityCreate, logEntityUpdate } = require('../services/activityLog.service');
const { HTTP_STATUS, PAGINATION } = require('../constants');
const { sendPaginated } = require('../utils/apiResponse');
const { parsePaginationQuery, parseSortQuery } = require('../utils/pagination');

const ROUTE_SORT_FIELDS = ['routeName', 'routeCode', 'vehicleNumber', 'createdAt', 'status'];
const REGISTRATION_SORT_FIELDS = ['updatedAt', 'status', 'serviceStartDate'];

const TRANSPORT_MODULE = 'transport';

function logTransportActivity({ action, description, user, entityId, entityLabel, meta }) {
  logEntityUpdate({
    module: TRANSPORT_MODULE,
    entityId,
    entityLabel,
    action,
    description,
    user,
    meta
  });
}

exports.listRoutes = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const search = req.query.search.trim();
    filter.$or = [
      { routeName: new RegExp(search, 'i') },
      { routeCode: new RegExp(search, 'i') },
      { vehicleNumber: new RegExp(search, 'i') },
      { driverName: new RegExp(search, 'i') }
    ];
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, ROUTE_SORT_FIELDS, 'routeName');

  const [routes, totalItems] = await Promise.all([
    BusRoute.find(filter).sort(sort).skip(skip).limit(pageSize),
    BusRoute.countDocuments(filter)
  ]);
  const enriched = await Promise.all(routes.map((route) => enrichRoute(route)));
  return sendPaginated(res, enriched, { page, pageSize, totalItems });
});

exports.createRoute = asyncHandler(async (req, res) => {
  const route = await createRoute(req.body, req.user);
  logTransportActivity({
    action: 'route_create',
    description: `Bus route created: ${route.routeCode}`,
    user: req.user,
    entityId: route._id,
    entityLabel: route.routeCode
  });
  res.status(HTTP_STATUS.CREATED).json(route);
});

exports.updateRoute = asyncHandler(async (req, res) => {
  const route = await updateRoute(req.params.id, req.body, req.user);
  logTransportActivity({
    action: 'route_update',
    description: `Bus route updated: ${route.routeCode}`,
    user: req.user,
    entityId: route._id,
    entityLabel: route.routeCode
  });
  res.json(route);
});

exports.toggleRouteStatus = asyncHandler(async (req, res) => {
  const route = await toggleRouteStatus(req.params.id, req.user);
  logTransportActivity({
    action: 'route_status_change',
    description: `Bus route ${route.status}: ${route.routeCode}`,
    user: req.user,
    entityId: route._id,
    entityLabel: route.routeCode
  });
  res.json(route);
});

exports.deleteRoute = asyncHandler(async (req, res) => {
  const route = await BusRoute.findById(req.params.id);
  if (!route) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Bus route not found' });
  route.status = 'inactive';
  route.updatedBy = req.user?.id;
  await route.save();
  logTransportActivity({
    action: 'route_deactivate',
    description: `Bus route deactivated: ${route.routeCode}`,
    user: req.user,
    entityId: route._id,
    entityLabel: route.routeCode
  });
  res.json({ message: 'Route deactivated' });
});

exports.listRegistrations = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.academicYear) filter.academicYear = req.query.academicYear;
  if (req.query.route) filter.route = req.query.route;
  if (req.query.student) filter.student = req.query.student;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.busService === 'true') filter.busService = true;
  if (req.query.busService === 'false') filter.busService = false;

  // Class/section filter — registrations don't store class, so resolve via student enrollments.
  if (req.query.classRoom) {
    const enrollmentMatch = { classRoom: req.query.classRoom };
    if (req.query.academicYear) enrollmentMatch.academicYear = req.query.academicYear;
    const classStudentIds = await Student.find({ enrollments: { $elemMatch: enrollmentMatch } }).distinct('_id');
    filter.student = { $in: classStudentIds };
  }

  if (req.query.search) {
    const term = req.query.search.trim();
    const regex = new RegExp(term, 'i');
    const students = await Student.find({
      $or: [{ admissionNumber: regex }, { firstName: regex }, { lastName: regex }]
    }).distinct('_id');
    const routes = await BusRoute.find({ $or: [{ routeName: regex }, { routeCode: regex }] }).distinct('_id');
    filter.$or = [{ student: { $in: students } }, { route: { $in: routes } }, { stopName: regex }];
  }

  const { page, pageSize, skip } = parsePaginationQuery(req.query, PAGINATION.DEFAULT_PAGE_SIZE);
  const sort = parseSortQuery(req.query, REGISTRATION_SORT_FIELDS, 'updatedAt');

  const [registrations, totalItems] = await Promise.all([
    BusRegistration.find(filter)
      .populate('student', 'firstName lastName admissionNumber status enrollments')
      .populate('academicYear', 'name')
      .populate('route', 'routeName routeCode vehicleNumber status')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    BusRegistration.countDocuments(filter)
  ]);

  return sendPaginated(res, registrations, { page, pageSize, totalItems });
});

exports.createRegistration = asyncHandler(async (req, res) => {
  const registration = await createRegistration(req.body, req.user);
  logTransportActivity({
    action: 'bus_registration',
    description: `Bus registration created for student ${registration.student?.admissionNumber || registration.student}`,
    user: req.user,
    entityId: registration._id,
    entityLabel: registration.student?.admissionNumber
  });
  res.status(HTTP_STATUS.CREATED).json(registration);
});

exports.updateRegistration = asyncHandler(async (req, res) => {
  const registration = await updateRegistration(req.params.id, req.body, req.user);
  logTransportActivity({
    action: 'bus_registration_update',
    description: `Bus registration updated for student ${registration.student?.admissionNumber || registration.student}`,
    user: req.user,
    entityId: registration._id,
    entityLabel: registration.student?.admissionNumber
  });
  res.json(registration);
});

exports.deactivateRegistration = asyncHandler(async (req, res) => {
  const registration = await deactivateRegistration(req.params.id, req.user);
  logTransportActivity({
    action: 'bus_registration_deactivate',
    description: `Bus service deactivated for student ${registration.student?.admissionNumber || registration.student}`,
    user: req.user,
    entityId: registration._id,
    entityLabel: registration.student?.admissionNumber
  });
  res.json(registration);
});

exports.getRegistration = asyncHandler(async (req, res) => {
  const registration = await populateRegistration(req.params.id);
  if (!registration) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Bus registration not found' });
  res.json(registration);
});

exports.getReport = asyncHandler(async (req, res) => {
  const rows = await buildReport(req.params.type, {
    academicYear: req.query.academicYear,
    route: req.query.route
  });
  const enriched = await enrichRegistrationRows(rows);
  res.json({ type: req.params.type, rows: enriched, total: enriched.length });
});

exports.downloadReportPdf = asyncHandler(async (req, res) => {
  const rows = await buildReport(req.params.type, {
    academicYear: req.query.academicYear,
    route: req.query.route
  });
  const enriched = await enrichRegistrationRows(rows);
  transportReportPdf(res, req.params.type, enriched);
});
