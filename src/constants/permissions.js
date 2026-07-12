const ACTIONS = ['view', 'create', 'edit', 'delete', 'deactivate', 'export', 'print', 'approve', 'unlock'];

const MODULES = [
  'dashboard',
  'academic_year',
  'classes',
  'teachers',
  'students',
  'users',
  'roles',
  'attendance',
  'fees',
  'payroll',
  'timetable',
  'exams',
  'reports',
  'transport',
  'governance'
];

function allPermissions(value = true) {
  return Object.fromEntries(
    MODULES.map((module) => [
      module,
      Object.fromEntries(ACTIONS.map((action) => [action, value]))
    ])
  );
}

function modulePerms(entries) {
  const result = {};
  for (const [module, actions] of Object.entries(entries)) {
    result[module] = Object.fromEntries(ACTIONS.map((action) => [action, !!actions[action]]));
  }
  return result;
}

const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: {
    name: 'Super Admin',
    description: 'Full system access including role and permission management',
    permissions: allPermissions(true)
  },
  admin: {
    name: 'Admin',
    description: 'School administrator with full operational access',
    permissions: modulePerms({
      dashboard: { view: true, export: true, print: true },
      academic_year: { view: true, create: true, edit: true, deactivate: true },
      classes: { view: true, create: true, edit: true, deactivate: true, export: true, print: true },
      teachers: { view: true, create: true, edit: true, deactivate: true, export: true, print: true, approve: true },
      students: { view: true, create: true, edit: true, delete: true, deactivate: true, export: true, print: true, approve: true, unlock: true },
      users: { view: true, create: true, edit: true, deactivate: true, unlock: true },
      roles: { view: true },
      attendance: { view: true, create: true, edit: true, export: true, print: true, unlock: true },
      fees: { view: true, create: true, edit: true, export: true, print: true, unlock: true },
      payroll: { view: true, create: true, edit: true, export: true, print: true, approve: true, unlock: true },
      timetable: { view: true, create: true, edit: true, print: true },
      exams: { view: true, create: true, edit: true, delete: true, approve: true, print: true },
      reports: { view: true, export: true, print: true },
      transport: { view: true, create: true, edit: true, deactivate: true, export: true, print: true },
      governance: { view: true, edit: true, export: true, print: true }
    })
  },
  principal: {
    name: 'Principal',
    description: 'School leadership with oversight across academic and operational modules',
    permissions: modulePerms({
      dashboard: { view: true, export: true, print: true },
      academic_year: { view: true, edit: true },
      classes: { view: true, edit: true, export: true, print: true },
      teachers: { view: true, edit: true, export: true, print: true, approve: true },
      students: { view: true, edit: true, export: true, print: true, approve: true },
      users: { view: true },
      roles: { view: true },
      attendance: { view: true, export: true, print: true, unlock: true },
      fees: { view: true, export: true, print: true },
      payroll: { view: true, export: true, print: true, approve: true },
      timetable: { view: true, print: true },
      exams: { view: true, approve: true, print: true },
      reports: { view: true, export: true, print: true },
      transport: { view: true, export: true, print: true },
      governance: { view: true, print: true }
    })
  },
  teacher: {
    name: 'Teacher',
    description: 'Class teacher and subject teacher access',
    permissions: modulePerms({
      dashboard: { view: true },
      classes: { view: true },
      teachers: { view: true, edit: true },
      students: { view: true, print: true },
      attendance: { view: true, create: true, edit: true, print: true },
      timetable: { view: true, print: true },
      exams: { view: true, create: true, edit: true, print: true }
    })
  },
  accountant: {
    name: 'Accountant',
    description: 'Finance and fee operations',
    permissions: modulePerms({
      dashboard: { view: true, export: true },
      students: { view: true, export: true, print: true },
      fees: { view: true, create: true, edit: true, export: true, print: true, unlock: true },
      payroll: { view: true, export: true, print: true, approve: true, unlock: true },
      reports: { view: true, export: true, print: true },
      transport: { view: true, export: true, print: true }
    })
  },
  transport_manager: {
    name: 'Transport Manager',
    description: 'Bus routes, registrations, and transport operations',
    permissions: modulePerms({
      dashboard: { view: true },
      students: { view: true, export: true },
      transport: { view: true, create: true, edit: true, deactivate: true, export: true, print: true },
      reports: { view: true, export: true, print: true }
    })
  },
  reception: {
    name: 'Reception',
    description: 'Front office admissions and student records',
    permissions: modulePerms({
      dashboard: { view: true },
      academic_year: { view: true },
      classes: { view: true },
      students: { view: true, create: true, edit: true, export: true, print: true },
      teachers: { view: true },
      transport: { view: true, create: true, edit: true }
    })
  },
  receptionist: {
    name: 'Receptionist',
    description: 'Front office admissions and student records',
    permissions: modulePerms({
      dashboard: { view: true },
      academic_year: { view: true },
      classes: { view: true },
      students: { view: true, create: true, edit: true, export: true, print: true },
      teachers: { view: true },
      transport: { view: true, create: true, edit: true }
    })
  },
  parent: {
    name: 'Parent',
    description: 'Guardian portal for linked children',
    permissions: modulePerms({
      dashboard: { view: true },
      students: { view: true },
      attendance: { view: true },
      fees: { view: true },
      timetable: { view: true, print: true },
      exams: { view: true }
    })
  },
  student: {
    name: 'Student',
    description: 'Student self-service portal',
    permissions: modulePerms({
      dashboard: { view: true },
      students: { view: true },
      attendance: { view: true },
      fees: { view: true },
      timetable: { view: true, print: true },
      exams: { view: true }
    })
  }
};

module.exports = {
  ACTIONS,
  MODULES,
  DEFAULT_ROLE_PERMISSIONS
};
