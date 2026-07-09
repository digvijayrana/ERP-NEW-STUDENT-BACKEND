const asyncHandler = require('../middleware/asyncHandler');
const { buildReport } = require('../services/report.service');
const { moduleReportPdf } = require('../services/pdf.service');
const { logEntityUpdate } = require('../services/activityLog.service');
const { ACTIONS } = require('../constants/activityActions');
const { HTTP_STATUS } = require('../constants');

const REPORTS_MODULE = 'reports';

function parseFilters(query) {
  return {
    academicYear: query.academicYear,
    classRoom: query.classRoom,
    section: query.section,
    status: query.status,
    student: query.student,
    admissionFrom: query.admissionFrom,
    admissionTo: query.admissionTo,
    month: query.month,
    year: query.year,
    date: query.date,
    paymentStatus: query.paymentStatus,
    payrollStatus: query.payrollStatus,
    department: query.department,
    designation: query.designation,
    route: query.route,
    stop: query.stop,
    busServiceStatus: query.busServiceStatus
  };
}

function logReportAccess(req, domain, reportType, format) {
  logEntityUpdate({
    module: REPORTS_MODULE,
    entityLabel: `${domain}/${reportType}`,
    action: ACTIONS.CREATE,
    description: `Report ${format}: ${domain}/${reportType}`,
    user: req.user,
    meta: { domain, reportType, format, filters: parseFilters(req.query) }
  });
}

exports.getReport = asyncHandler(async (req, res) => {
  const { domain, type } = req.params;
  const rows = await buildReport(domain, type, parseFilters(req.query));
  logReportAccess(req, domain, type, 'view');
  res.json({ domain, type, rows, total: rows.length });
});

exports.downloadReportPdf = asyncHandler(async (req, res) => {
  const { domain, type } = req.params;
  const rows = await buildReport(domain, type, parseFilters(req.query));
  logReportAccess(req, domain, type, 'pdf');
  moduleReportPdf(res, domain, type, rows);
});

exports.listReportTypes = asyncHandler(async (req, res) => {
  const { VALID_TYPES } = require('../services/report.service');
  res.json(VALID_TYPES);
});
