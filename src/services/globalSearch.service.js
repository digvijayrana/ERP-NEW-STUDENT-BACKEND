const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const FeeInvoice = require('../models/FeeInvoice');
const Payroll = require('../models/Payroll');
const BusRoute = require('../models/BusRoute');
const User = require('../models/User');
const { hasPermission } = require('./permission.service');
const { buildStudentFilterForUser } = require('./scope.service');
const { GLOBAL_SEARCH_LIMIT } = require('../config/workflow.config');
const { CACHE_TTL_MS } = require('../config/performance.config');
const { HTTP_STATUS } = require('../constants');
const { getOrSet } = require('./cache.service');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function canView(user, permissions, module) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return hasPermission(permissions, module, 'view');
}

function tabForType(type) {
  const map = {
    student: 'students',
    teacher: 'teachers',
    receipt: 'fees',
    payroll: 'payroll',
    route: 'transport',
    user: 'users'
  };
  return map[type] || 'dashboard';
}

async function searchStudents(query, user, permissions, limit) {
  if (!canView(user, permissions, 'students')) return [];
  const regex = new RegExp(escapeRegex(query), 'i');
  const scope = await buildStudentFilterForUser(user);
  const students = await Student.find({
    ...scope,
    $or: [
      { admissionNumber: regex },
      { firstName: regex },
      { lastName: regex },
      { 'guardians.phone': regex },
      { udisePenId: regex }
    ]
  })
    .select('admissionNumber firstName lastName status')
    .limit(limit)
    .lean();

  return students.map((student) => ({
    type: 'student',
    id: String(student._id),
    label: [student.firstName, student.lastName].filter(Boolean).join(' '),
    subtitle: student.admissionNumber,
    tab: tabForType('student')
  }));
}

async function searchTeachers(query, user, permissions, limit) {
  if (!canView(user, permissions, 'teachers')) return [];
  const regex = new RegExp(escapeRegex(query), 'i');
  const teachers = await Teacher.find({
    $or: [{ employeeCode: regex }, { firstName: regex }, { lastName: regex }, { email: regex }]
  })
    .select('employeeCode firstName lastName status')
    .limit(limit)
    .lean();

  return teachers.map((teacher) => ({
    type: 'teacher',
    id: String(teacher._id),
    label: [teacher.firstName, teacher.lastName].filter(Boolean).join(' '),
    subtitle: teacher.employeeCode,
    tab: tabForType('teacher')
  }));
}

async function searchReceipts(query, user, permissions, limit) {
  if (!canView(user, permissions, 'fees')) return [];
  const regex = new RegExp(escapeRegex(query), 'i');
  const invoices = await FeeInvoice.find({
    'payments.receiptNumber': regex
  })
    .populate('student', 'firstName lastName admissionNumber')
    .select('invoiceNumber student payments status')
    .limit(limit)
    .lean();

  const results = [];
  for (const invoice of invoices) {
    const payment = (invoice.payments || []).find((entry) => regex.test(entry.receiptNumber));
    if (!payment) continue;
    const student = invoice.student;
    results.push({
      type: 'receipt',
      id: String(invoice._id),
      label: payment.receiptNumber,
      subtitle: student
        ? `${student.admissionNumber} · ${[student.firstName, student.lastName].filter(Boolean).join(' ')}`
        : invoice.invoiceNumber,
      tab: tabForType('receipt'),
      meta: { paymentId: String(payment._id) }
    });
    if (results.length >= limit) break;
  }
  return results;
}

async function searchPayroll(query, user, permissions, limit) {
  if (!canView(user, permissions, 'payroll')) return [];
  const trimmed = String(query).trim();
  const filter = {};
  if (/^[a-f\d]{24}$/i.test(trimmed)) {
    filter._id = trimmed;
  } else {
    const monthMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{4})$/);
    if (monthMatch) {
      filter.month = Number(monthMatch[1]);
      filter.year = Number(monthMatch[2]);
    } else if (/^\d{4}$/.test(trimmed)) {
      filter.year = Number(trimmed);
    } else {
      return [];
    }
  }

  const payrolls = await Payroll.find(filter)
    .populate('teacher', 'firstName lastName employeeCode')
    .limit(limit)
    .lean();

  return payrolls.map((payroll) => ({
    type: 'payroll',
    id: String(payroll._id),
    label: `Payroll ${payroll.month}/${payroll.year}`,
    subtitle: payroll.teacher
      ? `${payroll.teacher.employeeCode} · ${[payroll.teacher.firstName, payroll.teacher.lastName].filter(Boolean).join(' ')}`
      : payroll.status,
    tab: tabForType('payroll')
  }));
}

async function searchRoutes(query, user, permissions, limit) {
  if (!canView(user, permissions, 'transport')) return [];
  const regex = new RegExp(escapeRegex(query), 'i');
  const routes = await BusRoute.find({
    $or: [{ routeCode: regex }, { routeName: regex }, { vehicleNumber: regex }]
  })
    .select('routeCode routeName vehicleNumber status')
    .limit(limit)
    .lean();

  return routes.map((route) => ({
    type: 'route',
    id: String(route._id),
    label: route.routeName,
    subtitle: route.routeCode,
    tab: tabForType('route')
  }));
}

async function searchUsers(query, user, permissions, limit) {
  if (!canView(user, permissions, 'users')) return [];
  const regex = new RegExp(escapeRegex(query), 'i');
  const users = await User.find({
    $or: [{ name: regex }, { email: regex }, { role: regex }]
  })
    .select('name email role isActive')
    .limit(limit)
    .lean();

  return users.map((entry) => ({
    type: 'user',
    id: String(entry._id),
    label: entry.name,
    subtitle: `${entry.email} · ${entry.role}`,
    tab: tabForType('user')
  }));
}

async function globalSearch(query, user, permissions) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) {
    const error = new Error('Search query must be at least 2 characters');
    error.status = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  const cacheKey = `${user?.role || 'anon'}:${trimmed.toLowerCase()}`;
  return getOrSet('globalSearch', cacheKey, CACHE_TTL_MS.globalSearch, async () => {
    const perTypeLimit = Math.max(2, Math.ceil(GLOBAL_SEARCH_LIMIT / 2));
    const buckets = await Promise.all([
      searchStudents(trimmed, user, permissions, perTypeLimit),
      searchTeachers(trimmed, user, permissions, perTypeLimit),
      searchReceipts(trimmed, user, permissions, perTypeLimit),
      searchPayroll(trimmed, user, permissions, perTypeLimit),
      searchRoutes(trimmed, user, permissions, perTypeLimit),
      searchUsers(trimmed, user, permissions, perTypeLimit)
    ]);

    return buckets.flat().slice(0, GLOBAL_SEARCH_LIMIT);
  });
}

module.exports = {
  globalSearch
};
