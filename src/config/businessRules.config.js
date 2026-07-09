module.exports = {
  PROTECTED_MASTER_FIELDS: [
    'createdBy',
    'updatedBy',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'deletedBy',
    'isDeleted',
    '__v'
  ],
  REVERSAL_ACTIONS: {
    fee_void: { module: 'fees', permission: 'unlock', label: 'Fee receipt reversal' },
    fee_unlock: { module: 'fees', permission: 'unlock', label: 'Fee receipt unlock' },
    payroll_unlock: { module: 'payroll', permission: 'unlock', label: 'Payroll unlock' },
    attendance_unlock: { module: 'attendance', permission: 'unlock', label: 'Attendance register unlock' },
    promotion_rollback: { module: 'students', permission: 'edit', label: 'Promotion rollback' }
  },
  LOCKABLE_MODULES: ['fees', 'payroll', 'attendance', 'promotion', 'academic_year'],
  AUDITABLE_OPERATIONS: [
    'create',
    'update',
    'delete',
    'soft_delete',
    'approve',
    'status_change',
    'lock',
    'unlock',
    'reversal',
    'login',
    'logout',
    'config_change'
  ]
};
