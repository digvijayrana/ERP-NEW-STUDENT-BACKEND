/**
 * Seed control-plane school registry + per-school databases.
 *
 * Usage:
 *   MULTI_TENANT=true node src/scripts/seedTenants.js
 *
 * Creates:
 *   super_admin_db → SchoolTenant { abc, xyz, demo } + platform super_admin user
 *   school_abc_db / school_xyz_db / school_demo_db → demo users each
 */
require('dotenv').config();

process.env.MULTI_TENANT = process.env.MULTI_TENANT || 'true';
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'localhost';

const mongoose = require('mongoose');
const {
  connectControlPlane,
  getSchoolTenantModel,
  getTenantConnection,
  CONTROL_PLANE_URI,
  bindModelsToConnection,
  getControlPlaneConnection
} = require('../services/tenantConnection.manager');

const SCHOOLS = [
  {
    slug: 'abc',
    name: 'ABC Public School',
    dbName: 'school_abc_db',
    logoUrl: '',
    website: 'http://abc.localhost',
    status: 'active'
  },
  {
    slug: 'xyz',
    name: 'XYZ International School',
    dbName: 'school_xyz_db',
    logoUrl: '',
    website: 'http://xyz.localhost',
    status: 'active'
  },
  {
    slug: 'demo',
    name: 'Demo Academy',
    dbName: 'school_demo_db',
    logoUrl: '',
    website: 'http://demo.localhost',
    status: 'active'
  }
];

async function seedPlatformAdmin(conn) {
  require('../models/loadAll');
  bindModelsToConnection(conn);
  const User = conn.models.User || conn.model('User', mongoose.model('User').schema);
  const email = process.env.ADMIN_EMAIL || 'admin@schoolerp.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  let user = await User.findOne({ email });
  if (!user) {
    user = new User({
      name: process.env.ADMIN_NAME || 'Platform Super Admin',
      email,
      role: 'super_admin',
      passwordHash: 'pending'
    });
    await user.setPassword(password);
    await user.save();
    console.log(`Platform admin: ${email} / ${password}`);
  } else {
    user.role = 'super_admin';
    await user.setPassword(password);
    await user.save();
    console.log(`Platform admin updated: ${email} / ${password}`);
  }
}

async function seedSchoolUsers(conn, school) {
  bindModelsToConnection(conn);
  const User = conn.models.User;
  const Teacher = conn.models.Teacher;
  const Student = conn.models.Student;
  const AcademicYear = conn.models.AcademicYear;
  const ClassRoom = conn.models.ClassRoom;
  const SchoolConfiguration = conn.models.SchoolConfiguration;

  await SchoolConfiguration.findOneAndUpdate(
    { key: 'master' },
    {
      $set: {
        school: {
          name: school.name,
          website: school.website,
          logoUrl: school.logoUrl || '',
          email: `info@${school.slug}.schoolerp.local`,
          phone: '+91 9876543210',
          board: 'CBSE'
        }
      }
    },
    { upsert: true, new: true }
  );

  let year = await AcademicYear.findOne({ status: 'active' });
  if (!year) {
    year = await AcademicYear.create({
      name: '2025-2026',
      startDate: new Date('2025-04-01'),
      endDate: new Date('2026-03-31'),
      status: 'active',
      isActive: true
    });
  }

  let teacher = await Teacher.findOne({ employeeCode: `TCH-${school.slug.toUpperCase()}` });
  if (!teacher) {
    teacher = await Teacher.create({
      employeeCode: `TCH-${school.slug.toUpperCase()}`,
      firstName: school.slug.toUpperCase(),
      lastName: 'Teacher',
      phone: '9876543210',
      email: `teacher@${school.slug}.schoolerp.local`,
      qualification: 'M.Ed',
      baseSalary: 45000
    });
  }

  let room = await ClassRoom.findOne({ name: '10', section: 'A', academicYear: year._id });
  if (!room) {
    room = await ClassRoom.create({
      name: '10',
      section: 'A',
      academicYear: year._id,
      classTeacher: teacher._id,
      subjects: [{ name: 'Mathematics', teacher: teacher._id }],
      capacity: 40,
      monthlyFee: 3500
    });
  }

  let student = await Student.findOne({ admissionNumber: `ADM-${school.slug.toUpperCase()}-001` });
  if (!student) {
    student = await Student.create({
      admissionNumber: `ADM-${school.slug.toUpperCase()}-001`,
      firstName: school.slug.toUpperCase(),
      lastName: 'Student',
      gender: 'male',
      dateOfBirth: new Date('2010-01-15'),
      address: {
        line1: '12 School Lane',
        city: 'City',
        state: 'State',
        pincode: '110001'
      },
      guardians: [
        {
          name: `${school.slug.toUpperCase()} Parent`,
          relation: 'Father',
          phone: '9876501234',
          email: `parent@${school.slug}.schoolerp.local`,
          isPrimary: true
        }
      ],
      enrollments: [{ classRoom: room._id, academicYear: year._id, status: 'studying' }]
    });
  }

  const accounts = [
    {
      role: 'admin',
      name: `${school.name} Admin`,
      email: `admin@${school.slug}.schoolerp.local`,
      password: 'Admin@12345'
    },
    {
      role: 'teacher',
      name: `${school.name} Teacher`,
      email: `teacher@${school.slug}.schoolerp.local`,
      password: 'Teacher@12345',
      teacher: teacher._id
    },
    {
      role: 'student',
      name: `${school.name} Student`,
      email: `student@${school.slug}.schoolerp.local`,
      password: 'Student@12345',
      student: student._id
    }
  ];

  for (const acc of accounts) {
    let user = await User.findOne({ email: acc.email });
    if (!user) {
      user = new User({
        name: acc.name,
        email: acc.email,
        role: acc.role,
        teacher: acc.teacher,
        student: acc.student,
        passwordHash: 'pending'
      });
    } else {
      user.role = acc.role;
      user.teacher = acc.teacher;
      user.student = acc.student;
    }
    await user.setPassword(acc.password);
    await user.save();
    console.log(`  ${school.slug}: ${acc.email} / ${acc.password}`);
  }
}

async function main() {
  console.log('Control plane URI:', CONTROL_PLANE_URI);
  await connectControlPlane();
  require('../models/loadAll');
  bindModelsToConnection(getControlPlaneConnection());

  const SchoolTenant = getSchoolTenantModel();
  for (const school of SCHOOLS) {
    await SchoolTenant.findOneAndUpdate(
      { slug: school.slug },
      { $set: school },
      { upsert: true, new: true }
    );
    console.log(`Registered tenant: ${school.slug} → ${school.dbName}`);
  }

  await seedPlatformAdmin(getControlPlaneConnection());

  for (const school of SCHOOLS) {
    console.log(`\nSeeding ${school.slug}...`);
    const conn = await getTenantConnection(school.slug, school);
    await seedSchoolUsers(conn, school);
  }

  console.log('\n--- Done ---');
  console.log('Hosts: admin/abc/xyz/demo.schoolerp.local → 127.0.0.1');
  console.log('Platform: admin@schoolerp.local / Admin@12345 @ http://admin.schoolerp.local');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
