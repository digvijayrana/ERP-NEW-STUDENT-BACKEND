require('dotenv').config();

const connectDb = require('../config/db');
const AcademicYear = require('../models/AcademicYear');
const ClassRoom = require('../models/ClassRoom');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const User = require('../models/User');

const DEMO_ACCOUNTS = [
  {
    role: 'teacher',
    name: 'Demo Teacher',
    email: process.env.TEACHER_EMAIL || 'teacher@schoolerp.local',
    password: process.env.TEACHER_PASSWORD || 'Teacher@12345'
  },
  {
    role: 'student',
    name: 'Demo Student',
    email: process.env.STUDENT_EMAIL || 'student@schoolerp.local',
    password: process.env.STUDENT_PASSWORD || 'Student@12345'
  },
  {
    role: 'parent',
    name: 'Demo Parent',
    email: process.env.PARENT_EMAIL || 'parent@schoolerp.local',
    password: process.env.PARENT_PASSWORD || 'Parent@12345'
  }
];

async function ensureUser({ name, email, password, role, teacher, student, linkedStudent }) {
  let user = await User.findOne({ email });
  if (!user) {
    user = new User({ name, email, role, teacher, student, linkedStudent, passwordHash: 'pending' });
    await user.setPassword(password);
    await user.save();
    console.log(`Created ${role} login: ${email} / ${password}`);
    return user;
  }

  user.name = name;
  user.role = role;
  user.teacher = teacher;
  user.student = student;
  user.linkedStudent = linkedStudent;
  user.isActive = true;
  await user.setPassword(password);
  await user.save();
  console.log(`Updated ${role} login: ${email} / ${password}`);
  return user;
}

async function seedDemoUsers() {
  await connectDb();

  let academicYear = await AcademicYear.findOne({ isActive: true });
  if (!academicYear) {
    academicYear = await AcademicYear.create({
      name: '2025-2026',
      startDate: new Date('2025-04-01'),
      endDate: new Date('2026-03-31'),
      isActive: true
    });
    console.log('Created academic year 2025-2026');
  }

  let teacher = await Teacher.findOne({ employeeCode: 'TCH-001' });
  if (!teacher) {
    teacher = await Teacher.create({
      employeeCode: 'TCH-001',
      firstName: 'Ravi',
      lastName: 'Sharma',
      phone: '9876543210',
      email: 'ravi.sharma@schoolerp.local',
      qualification: 'M.Ed',
      baseSalary: 45000
    });
    console.log('Created teacher profile TCH-001');
  }

  let classRoom = await ClassRoom.findOne({ name: '8', section: 'A', academicYear: academicYear._id });
  if (!classRoom) {
    classRoom = await ClassRoom.create({
      name: '8',
      section: 'A',
      capacity: 40,
      academicYear: academicYear._id,
      classTeacher: teacher._id,
      monthlyFee: 3500
    });
    console.log('Created class 8-A');
  } else if (!classRoom.classTeacher) {
    classRoom.classTeacher = teacher._id;
    await classRoom.save();
  }

  let student = await Student.findOne({ admissionNumber: 'ADM-DEMO-001' });
  if (!student) {
    student = await Student.create({
      admissionNumber: 'ADM-DEMO-001',
      firstName: 'Aarav',
      lastName: 'Patel',
      gender: 'male',
      dateOfBirth: new Date('2012-05-15'),
      address: {
        line1: '12 School Lane',
        city: 'Ahmedabad',
        state: 'Gujarat',
        pincode: '380001'
      },
      guardians: [
        {
          name: 'Demo Parent',
          relation: 'Father',
          phone: '9876501234',
          email: 'parent@schoolerp.local',
          isPrimary: true
        }
      ],
      enrollments: [
        {
          academicYear: academicYear._id,
          classRoom: classRoom._id,
          rollNumber: '12',
          status: 'studying'
        }
      ]
    });
    console.log('Created student ADM-DEMO-001');
  }

  const teacherAccount = DEMO_ACCOUNTS.find((a) => a.role === 'teacher');
  const studentAccount = DEMO_ACCOUNTS.find((a) => a.role === 'student');
  const parentAccount = DEMO_ACCOUNTS.find((a) => a.role === 'parent');

  await ensureUser({ ...teacherAccount, teacher: teacher._id });
  await ensureUser({ ...studentAccount, student: student._id });
  await ensureUser({ ...parentAccount, linkedStudent: student._id });

  console.log('\n--- Demo login credentials ---');
  console.log('Admin:   admin@schoolerp.local   / Admin@12345');
  console.log(`Teacher: ${teacherAccount.email} / ${teacherAccount.password}`);
  console.log(`Student: ${studentAccount.email} / ${studentAccount.password}`);
  console.log(`Parent:  ${parentAccount.email} / ${parentAccount.password}`);
  console.log('\nSelect the matching role card on the login screen before signing in.');
  process.exit(0);
}

seedDemoUsers().catch((error) => {
  console.error(error);
  process.exit(1);
});
