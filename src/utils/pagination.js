const { PAGINATION } = require('../constants');

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];

function parsePaginationQuery(query, defaultPageSize = 10) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  let pageSize = Number.parseInt(query.pageSize, 10) || defaultPageSize;
  if (!ALLOWED_PAGE_SIZES.includes(pageSize)) {
    pageSize = ALLOWED_PAGE_SIZES.includes(defaultPageSize) ? defaultPageSize : 10;
  }
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
}

function parseSortQuery(query, allowedFields, defaultField = 'createdAt') {
  const field = allowedFields.includes(query.sortField) ? query.sortField : defaultField;
  const dir = query.sortDir === 'asc' ? 1 : -1;
  return { [field]: dir };
}

function duplicateKeyField(err) {
  const keyPattern = err?.keyPattern || {};
  const keys = Object.keys(keyPattern);

  if (keys.includes('teacher') && keys.includes('month') && keys.includes('year')) {
    return 'A payroll record already exists for this teacher in the selected month';
  }
  if (keys.includes('student') && keys.includes('date')) {
    return 'Attendance already exists for this student on the selected date';
  }
  if (keys.includes('student') && keys.includes('academicYear') && keys.includes('feeMonth')) {
    return 'A fee demand already exists for this student and period';
  }
  if (keys.includes('student') && keys.includes('academicYear') && keyPattern.busService) {
    return 'Student already has an active bus registration for this academic year';
  }
  if (keys.includes('academicYear') && keys.includes('classRoom') && keys.includes('date')) {
    return 'An attendance register already exists for this class and date';
  }

  const key = keys[0] || (err?.keyValue ? Object.keys(err.keyValue)[0] : null);
  const labels = {
    name: 'Name',
    email: 'Email',
    employeeCode: 'Employee code',
    admissionNumber: 'Admission number',
    aadhaarNumber: 'Aadhaar number',
    udisePenId: 'UDISE/PEN ID',
    phone: 'Phone number',
    slug: 'Role slug',
    invoiceNumber: 'Invoice number',
    receiptNumber: 'Receipt number'
  };
  if (key === 'name' && keyPattern.section) return 'Class and section already exist for this academic year';
  return labels[key] ? `${labels[key]} already exists` : 'Duplicate record found';
}

module.exports = {
  ALLOWED_PAGE_SIZES,
  parsePaginationQuery,
  parseSortQuery,
  duplicateKeyField
};
