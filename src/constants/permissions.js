const ACTIONS = ['view', 'create', 'edit', 'deactivate', 'export', 'approve'];

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
  'transport'
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
      dashboard: { view: true, export: true },
      academic_year: { view: true, create: true, edit: true, deactivate: true },
      classes: { view: true, create: true, edit: true, deactivate: true, export: true },
      teachers: { view: true, create: true, edit: true, deactivate: true, export: true },
      students: { view: true, create: true, edit: true, deactivate: true, export: true, approve: true },
      users: { view: true, create: true, edit: true, deactivate: true },
      roles: { view: true },
      attendance: { view: true, create: true, edit: true, export: true },
      fees: { view: true, create: true, edit: true },
      payroll: { view: true, create: true, edit: true },
      timetable: { view: true, create: true, edit: true },
      exams: { view: true, create: true, edit: true, approve: true },
      reports: { view: true, export: true },
      transport: { view: true, create: true, edit: true, deactivate: true, export: true }
    })
  },
  teacher: {
    name: 'Teacher',
    description: 'Class teacher and subject teacher access',
    permissions: modulePerms({
      dashboard: { view: true },
      classes: { view: true },
      teachers: { view: true, edit: true },
      students: { view: true },
      attendance: { view: true, create: true, edit: true },
      timetable: { view: true },
      exams: { view: true, create: true, edit: true }
    })
  },
  reception: {
    name: 'Reception',
    description: 'Front office admissions and student records',
    permissions: modulePerms({
      dashboard: { view: true },
      academic_year: { view: true },
      classes: { view: true },
      students: { view: true, create: true, edit: true, export: true },
      teachers: { view: true },
      transport: { view: true, create: true, edit: true }
    })
  },
  accountant: {
    name: 'Accountant',
    description: 'Finance and fee operations',
    permissions: modulePerms({
      dashboard: { view: true },
      students: { view: true, export: true },
      fees: { view: true, create: true, edit: true, export: true },
      payroll: { view: true, export: true },
      reports: { view: true, export: true },
      transport: { view: true, export: true }
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
      timetable: { view: true },
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
      timetable: { view: true },
      exams: { view: true }
    })
  }
};

module.exports = {
  ACTIONS,
  MODULES,
  DEFAULT_ROLE_PERMISSIONS
};
