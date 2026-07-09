const asyncHandler = require('../middleware/asyncHandler');
const { buildReport } = require('../services/report.service');
const { moduleReportPdf } = require('../services/pdf.service');
const { logReportAccess } = require('../services/businessRules.service');
const { HTTP_STATUS, PAGINATION } = require('../constants');

function parseFilters(query) {
  return {
    academicYear: query.academicYear,
    classRoom: query.classRoom,
    section: query.section,
    status: query.status,
    student: query.student,
    teacher: query.teacher,
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
    busServiceStatus: query.busServiceStatus,
    performanceCategory: query.performanceCategory,
    promotionStatus: query.promotionStatus,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
    page: query.page,
    pageSize: query.pageSize
  };
}

function sortRows(rows, sortBy, sortDir = 'asc') {
  if (!sortBy) return rows;
  const direction = sortDir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = a[sortBy];
    const right = b[sortBy];
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return String(left).localeCompare(String(right)) * direction;
  });
}

function paginateRows(rows, query) {
  const sorted = sortRows(rows, query.sortBy, query.sortDir);
  if (!query.page && !query.pageSize) {
    return { rows: sorted, total: sorted.length, page: 1, pageSize: sorted.length || 1 };
  }
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(query.pageSize) || PAGINATION.DEFAULT_PAGE_SIZE), PAGINATION.MAX_PAGE_SIZE);
  const skip = (page - 1) * pageSize;
  return {
    rows: sorted.slice(skip, skip + pageSize),
    total: sorted.length,
    page,
    pageSize
  };
}

function rowsToCsv(rows, columns) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = columns.map((col) => escape(col.label)).join(',');
  const body = rows.map((row) => columns.map((col) => escape(row[col.key])).join(',')).join('\n');
  return `\uFEFF${header}\n${body}`;
}


exports.getReport = asyncHandler(async (req, res) => {
  const { domain, type } = req.params;
  const filters = parseFilters(req.query);
  const allRows = await buildReport(domain, type, filters);
  const paged = paginateRows(allRows, filters);
  logReportAccess(req, domain, type, 'view', filters);
  res.json({ domain, type, ...paged });
});

exports.downloadReportPdf = asyncHandler(async (req, res) => {
  const { domain, type } = req.params;
  const filters = parseFilters(req.query);
  const rows = sortRows(await buildReport(domain, type, filters), filters.sortBy, filters.sortDir);
  logReportAccess(req, domain, type, 'pdf', filters);
  moduleReportPdf(res, domain, type, rows);
});

exports.downloadReportCsv = asyncHandler(async (req, res) => {
  const { domain, type } = req.params;
  const filters = parseFilters(req.query);
  const rows = sortRows(await buildReport(domain, type, filters), filters.sortBy, filters.sortDir);
  const columns = (req.query.columns || '').split(',').filter(Boolean).map((entry) => {
    const [key, label] = entry.split(':');
    return { key, label: label || key };
  });
  const fallbackColumns = columns.length
    ? columns
    : rows[0]
      ? Object.keys(rows[0]).map((key) => ({ key, label: key }))
      : [{ key: 'message', label: 'Message' }];
  const csv = rowsToCsv(rows, fallbackColumns);
  logReportAccess(req, domain, type, 'csv', filters);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${domain}-${type}.csv"`);
  res.send(csv);
});

exports.listReportTypes = asyncHandler(async (_req, res) => {
  const { VALID_TYPES } = require('../services/report.service');
  res.json(VALID_TYPES);
});
