const Student = require('../models/Student');
const ClassRoom = require('../models/ClassRoom');
const FeeInvoice = require('../models/FeeInvoice');
const Payroll = require('../models/Payroll');
const Teacher = require('../models/Teacher');
const attendanceService = require('./attendance.service');
const busService = require('./bus.service');
const { HTTP_STATUS } = require('../constants');

const PRESENT_STATUSES = new Set(['present', 'late', 'half_day']);

function studentLabel(student) {
  if (!student) return '';
  return [student.firstName, student.lastName].filter(Boolean).join(' ');
}

function teacherLabel(teacher) {
  if (!teacher) return '';
  return [teacher.firstName, teacher.lastName].filter(Boolean).join(' ');
}

function classLabel(room) {
  if (!room) return '';
  return `${room.name || ''}-${room.section || ''}`.replace(/^-|-$/g, '') || '—';
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function resolveEnrollment(student, academicYearId) {
  const enrollments = student.enrollments || [];
  if (academicYearId) {
    const match = enrollments.find((entry) => String(entry.academicYear) === String(academicYearId));
    if (match) return match;
    return null;
  }
  return enrollments[enrollments.length - 1] || null;
}

function teacherDesignation(teacher) {
  const experiences = teacher?.experience || [];
  if (!experiences.length) return teacher?.qualification || '—';
  const latest = [...experiences].sort((a, b) => new Date(b.fromDate || 0) - new Date(a.fromDate || 0))[0];
  return latest?.designation || teacher?.qualification || '—';
}

async function loadClassMap(classIds = []) {
  const ids = [...new Set(classIds.filter(Boolean))];
  if (!ids.length) return {};
  const rooms = await ClassRoom.find({ _id: { $in: ids } }).select('name section').lean();
  return Object.fromEntries(rooms.map((room) => [String(room._id), room]));
}

async function loadStudentRows(filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;

  const admissionFrom = parseDate(filters.admissionFrom);
  const admissionTo = parseDate(filters.admissionTo);
  if (admissionFrom || admissionTo) {
    query.admissionDate = {};
    if (admissionFrom) query.admissionDate.$gte = startOfDay(admissionFrom);
    if (admissionTo) query.admissionDate.$lte = endOfDay(admissionTo);
  }

  const students = await Student.find(query)
    .sort({ admissionNumber: 1 })
    .lean();

  const classIds = [];
  const rows = [];

  for (const student of students) {
    const enrollment = resolveEnrollment(student, filters.academicYear);
    if (filters.academicYear && !enrollment) continue;
    if (filters.classRoom && String(enrollment?.classRoom) !== String(filters.classRoom)) continue;
    if (enrollment?.classRoom) classIds.push(enrollment.classRoom);
    rows.push({ student, enrollment });
  }

  const classMap = await loadClassMap(classIds);

  let mapped = rows.map(({ student, enrollment }) => {
    const room = enrollment?.classRoom ? classMap[String(enrollment.classRoom)] : null;
    return {
      admissionNumber: student.admissionNumber,
      studentName: studentLabel(student),
      gender: student.gender,
      dateOfBirth: student.dateOfBirth,
      admissionDate: student.admissionDate,
      status: student.status,
      className: room?.name || '—',
      section: room?.section || '—',
      classSection: classLabel(room),
      rollNumber: enrollment?.rollNumber || '—',
      academicYearId: enrollment?.academicYear || filters.academicYear || null
    };
  });

  if (filters.section) {
    mapped = mapped.filter((row) => row.section === filters.section);
  }

  return mapped;
}

async function buildStudentReport(reportType, filters = {}) {
  const rows = await loadStudentRows(filters);

  if (reportType === 'register') {
    return rows;
  }

  if (reportType === 'admission-register') {
    return [...rows].sort((a, b) => new Date(b.admissionDate || 0) - new Date(a.admissionDate || 0));
  }

  if (reportType === 'class-wise') {
    const grouped = new Map();
    for (const row of rows) {
      const key = row.className || 'Unassigned';
      const bucket = grouped.get(key) || { className: key, totalStudents: 0, activeStudents: 0, inactiveStudents: 0 };
      bucket.totalStudents += 1;
      if (row.status === 'active') bucket.activeStudents += 1;
      else bucket.inactiveStudents += 1;
      grouped.set(key, bucket);
    }
    return [...grouped.values()].sort((a, b) => a.className.localeCompare(b.className));
  }

  if (reportType === 'section-wise') {
    const grouped = new Map();
    for (const row of rows) {
      const key = row.classSection || 'Unassigned';
      const bucket = grouped.get(key) || { classSection: key, className: row.className, section: row.section, totalStudents: 0, activeStudents: 0 };
      bucket.totalStudents += 1;
      if (row.status === 'active') bucket.activeStudents += 1;
      grouped.set(key, bucket);
    }
    return [...grouped.values()].sort((a, b) => a.classSection.localeCompare(b.classSection));
  }

  if (reportType === 'status') {
    const grouped = new Map();
    for (const row of rows) {
      const key = row.status || 'unknown';
      const bucket = grouped.get(key) || { status: key, totalStudents: 0 };
      bucket.totalStudents += 1;
      grouped.set(key, bucket);
    }
    return [...grouped.values()].sort((a, b) => a.status.localeCompare(b.status));
  }

  const error = new Error('Unknown student report type');
  error.status = HTTP_STATUS.BAD_REQUEST;
  throw error;
}

async function buildFeeReport(reportType, filters = {}) {
  if (reportType === 'bus-fee-collection') {
    return busService.buildReport('fee-collection', {
      academicYear: filters.academicYear,
      route: filters.route
    });
  }

  if (reportType === 'monthly-collection') {
    const month = Number(filters.month) || new Date().getMonth() + 1;
    const year = Number(filters.year) || new Date().getFullYear();
    const invoiceFilter = { feeMonth: month, feeYear: year, status: { $ne: 'cancelled' } };
    if (filters.academicYear) invoiceFilter.academicYear = filters.academicYear;
    if (filters.classRoom) invoiceFilter.classRoom = filters.classRoom;
    if (filters.paymentStatus) invoiceFilter.status = filters.paymentStatus;

    const invoices = await FeeInvoice.find(invoiceFilter)
      .populate('student', 'firstName lastName admissionNumber')
      .populate('classRoom', 'name section')
      .populate('academicYear', 'name')
      .lean({ virtuals: true });

    return invoices.flatMap((invoice) => {
      const payments = (invoice.payments || []).filter((payment) => payment.status !== 'void');
      const base = {
        studentName: studentLabel(invoice.student),
        admissionNumber: invoice.student?.admissionNumber || '',
        className: classLabel(invoice.classRoom),
        academicYear: invoice.academicYear?.name || '',
        feeMonth: `${invoice.feeMonth}/${invoice.feeYear}`,
        totalAmount: invoice.totalAmount,
        paidAmount: invoice.paidAmount,
        pendingAmount: invoice.balanceAmount,
        status: invoice.status
      };
      if (!payments.length) return [base];
      return payments.map((payment) => ({
        ...base,
        paidAmount: payment.amount,
        receiptNumber: payment.receiptNumber,
        paymentDate: payment.paidAt,
        paymentMode: payment.mode
      }));
    });
  }

  if (reportType === 'pending') {
    const invoiceFilter = { status: { $in: ['unpaid', 'partial'] } };
    if (filters.academicYear) invoiceFilter.academicYear = filters.academicYear;
    if (filters.classRoom) invoiceFilter.classRoom = filters.classRoom;
    if (filters.paymentStatus && filters.paymentStatus !== 'pending') {
      invoiceFilter.status = filters.paymentStatus;
    }

    const invoices = await FeeInvoice.find(invoiceFilter)
      .populate('student', 'firstName lastName admissionNumber')
      .populate('classRoom', 'name section')
      .populate('academicYear', 'name')
      .sort({ dueDate: 1 })
      .lean({ virtuals: true });

    let rows = invoices.map((invoice) => ({
      studentName: studentLabel(invoice.student),
      admissionNumber: invoice.student?.admissionNumber || '',
      className: classLabel(invoice.classRoom),
      academicYear: invoice.academicYear?.name || '',
      feeMonth: `${invoice.feeMonth}/${invoice.feeYear}`,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount,
      pendingAmount: invoice.balanceAmount,
      status: invoice.status
    }));

    if (filters.section) {
      rows = rows.filter((row) => row.className.endsWith(`-${filters.section}`));
    }
    return rows;
  }

  if (reportType === 'student-ledger') {
    const invoiceFilter = { status: { $ne: 'cancelled' } };
    if (filters.academicYear) invoiceFilter.academicYear = filters.academicYear;
    if (filters.student) invoiceFilter.student = filters.student;
    if (filters.classRoom) invoiceFilter.classRoom = filters.classRoom;

    const invoices = await FeeInvoice.find(invoiceFilter)
      .populate('student', 'firstName lastName admissionNumber')
      .populate('classRoom', 'name section')
      .populate('academicYear', 'name')
      .sort({ feeYear: 1, feeMonth: 1, createdAt: 1 })
      .lean({ virtuals: true });

    const ledger = [];
    for (const invoice of invoices) {
      ledger.push({
        entryType: 'invoice',
        studentName: studentLabel(invoice.student),
        admissionNumber: invoice.student?.admissionNumber || '',
        className: classLabel(invoice.classRoom),
        academicYear: invoice.academicYear?.name || '',
        feeMonth: `${invoice.feeMonth}/${invoice.feeYear}`,
        description: `Fee invoice ${invoice.invoiceNumber}`,
        debit: invoice.totalAmount,
        credit: 0,
        balance: invoice.balanceAmount,
        status: invoice.status,
        date: invoice.dueDate
      });
      for (const payment of (invoice.payments || []).filter((row) => row.status !== 'void')) {
        ledger.push({
          entryType: 'payment',
          studentName: studentLabel(invoice.student),
          admissionNumber: invoice.student?.admissionNumber || '',
          className: classLabel(invoice.classRoom),
          academicYear: invoice.academicYear?.name || '',
          feeMonth: `${invoice.feeMonth}/${invoice.feeYear}`,
          description: `Payment ${payment.receiptNumber}`,
          debit: 0,
          credit: payment.amount,
          balance: invoice.balanceAmount,
          status: invoice.status,
          date: payment.paidAt,
          receiptNumber: payment.receiptNumber,
          paymentMode: payment.mode
        });
      }
    }
    return ledger.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  }

  const error = new Error('Unknown fee report type');
  error.status = HTTP_STATUS.BAD_REQUEST;
  throw error;
}

async function buildPayrollReport(reportType, filters = {}) {
  const match = {};
  if (filters.month) match.month = Number(filters.month);
  if (filters.year) match.year = Number(filters.year);
  if (filters.payrollStatus || filters.status) match.status = filters.payrollStatus || filters.status;

  const payrolls = await Payroll.find(match)
    .populate('teacher', 'firstName lastName employeeCode qualification experience')
    .sort({ year: -1, month: -1 })
    .lean({ virtuals: true });

  let rows = payrolls.map((row) => ({
    employeeCode: row.teacher?.employeeCode || '',
    teacherName: teacherLabel(row.teacher),
    department: row.teacher?.qualification || 'General',
    designation: teacherDesignation(row.teacher),
    month: row.month,
    year: row.year,
    payrollMonth: `${row.month}/${row.year}`,
    basicSalary: row.basicSalary,
    allowances: row.allowances,
    deductions: row.deductions,
    netSalary: row.netSalary,
    status: row.status,
    paidAt: row.paidAt,
    paymentMode: row.paymentMode
  }));

  if (filters.department) {
    const needle = String(filters.department).toLowerCase();
    rows = rows.filter((row) => row.department.toLowerCase().includes(needle));
  }
  if (filters.designation) {
    const needle = String(filters.designation).toLowerCase();
    rows = rows.filter((row) => row.designation.toLowerCase().includes(needle));
  }

  if (reportType === 'salary-summary') {
    return rows;
  }

  if (reportType === 'payment-status') {
    return rows.sort((a, b) => {
      if (a.status === b.status) return a.teacherName.localeCompare(b.teacherName);
      return a.status === 'pending' ? -1 : 1;
    });
  }

  if (reportType === 'summary') {
    const grouped = new Map();
    for (const row of rows) {
      const key = row.payrollMonth;
      const bucket = grouped.get(key) || {
        payrollMonth: key,
        month: row.month,
        year: row.year,
        employeeCount: 0,
        paidCount: 0,
        pendingCount: 0,
        totalBasic: 0,
        totalAllowances: 0,
        totalDeductions: 0,
        totalNet: 0,
        paidAmount: 0,
        pendingAmount: 0
      };
      bucket.employeeCount += 1;
      bucket.totalBasic += row.basicSalary || 0;
      bucket.totalAllowances += row.allowances || 0;
      bucket.totalDeductions += row.deductions || 0;
      bucket.totalNet += row.netSalary || 0;
      if (row.status === 'paid') {
        bucket.paidCount += 1;
        bucket.paidAmount += row.netSalary || 0;
      } else {
        bucket.pendingCount += 1;
        bucket.pendingAmount += row.netSalary || 0;
      }
      grouped.set(key, bucket);
    }
    return [...grouped.values()].sort((a, b) => b.year - a.year || b.month - a.month);
  }

  const error = new Error('Unknown payroll report type');
  error.status = HTTP_STATUS.BAD_REQUEST;
  throw error;
}

async function buildTransportReport(reportType, filters = {}) {
  const rows = await busService.buildReport(reportType, {
    academicYear: filters.academicYear,
    route: filters.route,
    stop: filters.stop,
    busServiceStatus: filters.busServiceStatus
  });

  if (reportType === 'fee-collection') {
    return rows;
  }

  let enriched = await busService.enrichRegistrationRows(rows);

  if (filters.stop) {
    enriched = enriched.filter((row) => row.stopName === filters.stop);
  }
  if (filters.busServiceStatus === 'active') {
    enriched = enriched.filter((row) => row.busService && row.status === 'active');
  } else if (filters.busServiceStatus === 'inactive') {
    enriched = enriched.filter((row) => !row.busService || row.status !== 'active');
  }

  return enriched;
}

const DOMAIN_BUILDERS = {
  students: buildStudentReport,
  fees: buildFeeReport,
  attendance: (type, filters) => attendanceService.buildReport(type, filters),
  payroll: buildPayrollReport,
  transport: buildTransportReport
};

const VALID_TYPES = {
  students: ['register', 'admission-register', 'class-wise', 'section-wise', 'status'],
  fees: ['monthly-collection', 'pending', 'student-ledger', 'bus-fee-collection'],
  attendance: ['daily', 'monthly', 'student-summary', 'class-summary'],
  payroll: ['summary', 'salary-summary', 'payment-status'],
  transport: ['route-wise', 'stop-wise', 'bus-strength', 'fee-collection']
};

async function buildReport(domain, reportType, filters = {}) {
  const builder = DOMAIN_BUILDERS[domain];
  if (!builder) {
    const error = new Error('Unknown report domain');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
  const allowed = VALID_TYPES[domain] || [];
  if (!allowed.includes(reportType)) {
    const error = new Error('Unknown report type for domain');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
  return builder(reportType, filters);
}

module.exports = {
  buildReport,
  VALID_TYPES,
  buildStudentReport,
  buildFeeReport,
  buildPayrollReport,
  buildTransportReport
};
