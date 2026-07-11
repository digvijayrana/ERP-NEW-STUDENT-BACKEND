const crypto = require('crypto');
const User = require('../models/User');
const Parent = require('../models/Parent');
const VerificationToken = require('../models/VerificationToken');
const { ROLES } = require('../constants');
const { computePasswordExpiry } = require('./security.service');
const { auditOnCreate, recordActivity } = require('./activityLog.service');
const { MODULES } = require('../constants/activityActions');
const { sendVerificationEmail, sendStudentCredentials } = require('./email.service');
const { createLogger } = require('../utils/logger');

const log = createLogger('provisioning');

const EMAIL_VERIFICATION_TTL_MS = Number(process.env.EMAIL_VERIFICATION_TTL_MS) || 48 * 60 * 60 * 1000;

function generateTemporaryPassword() {
  // Satisfies the default password policy (upper, lower, number, special, length).
  return `Tmp@${crypto.randomBytes(4).toString('hex')}9`;
}

function slugifyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 20) || 'user';
}

async function generateUniqueUsername(base) {
  const root = slugifyName(base);
  let candidate = root;
  let suffix = 0;
  // eslint-disable-next-line no-await-in-loop
  while (await User.exists({ username: candidate })) {
    suffix += 1;
    candidate = `${root}${suffix}`;
  }
  return candidate;
}

/**
 * Creates (or returns the existing) central User account for a Student.
 * Students log in with a username + temporary password and are forced to change
 * it on first login. Email verification is NOT required for students.
 * @returns {{ user, username, temporaryPassword } | { user, existing: true }}
 */
async function provisionStudentUser({ student, actor, req } = {}) {
  if (!student?._id) return null;
  if (student.user) {
    const existing = await User.findById(student.user);
    if (existing) return { user: existing, existing: true };
  }

  const fullName = [student.firstName, student.lastName].filter(Boolean).join(' ').trim() || 'Student';
  const usernameBase = `${student.firstName || 'student'}.${String(student.admissionNumber || '').replace(/[^a-z0-9]/gi, '')}`;
  const username = await generateUniqueUsername(usernameBase);
  const temporaryPassword = generateTemporaryPassword();

  // A guardian's email belongs to the parent account, so the student login uses
  // a stable synthesized placeholder to satisfy the required+unique email field
  // without colliding with the parent User's email.
  const primaryGuardianEmail = (student.guardians || []).find((g) => g.email)?.email;
  const email = `${username}@students.school-erp.local`;

  const user = new User({
    name: fullName,
    email: email.toLowerCase(),
    username,
    role: ROLES.STUDENT,
    student: student._id,
    passwordHash: 'pending',
    mustChangePassword: true,
    isTemporaryPassword: true,
    isEmailVerified: true,
    emailVerificationRequired: false,
    passwordExpiresAt: computePasswordExpiry(),
    ...auditOnCreate(actor)
  });
  await user.setPassword(temporaryPassword);
  await user.save();

  student.user = user._id;
  await student.save();

  recordActivity({
    module: MODULES.USERS,
    entityId: user._id,
    entityLabel: user.username,
    action: 'student_account_provisioned',
    description: `Student login account created for ${fullName}`,
    user: actor,
    req,
    meta: { username, studentId: student._id }
  });

  // Best-effort credential email if a guardian email exists.
  if (primaryGuardianEmail) {
    sendStudentCredentials({ to: primaryGuardianEmail, name: fullName, username, temporaryPassword })
      .catch((error) => log.warn('Failed to email student credentials', { error: error.message }));
  }

  return { user, username, temporaryPassword };
}

/**
 * Creates the central User account for a Teacher and sends a verification email.
 * Teachers cannot log in until they verify their email and set a password.
 * Requires teacher.email.
 */
async function provisionTeacherUser({ teacher, actor, req } = {}) {
  if (!teacher?._id || !teacher.email) return null;
  if (teacher.user) {
    const existing = await User.findById(teacher.user);
    if (existing) return { user: existing, existing: true };
  }
  if (await User.exists({ email: String(teacher.email).toLowerCase() })) {
    log.warn('Teacher email already has a user account - skipping provisioning', { email: teacher.email });
    return null;
  }

  const fullName = [teacher.firstName, teacher.lastName].filter(Boolean).join(' ').trim() || 'Teacher';
  const user = new User({
    name: fullName,
    email: String(teacher.email).toLowerCase(),
    role: ROLES.TEACHER,
    teacher: teacher._id,
    passwordHash: 'pending',
    // No usable password yet - set during email verification.
    mustChangePassword: true,
    isEmailVerified: false,
    emailVerificationRequired: true,
    ...auditOnCreate(actor)
  });
  await user.setPassword(generateTemporaryPassword());
  await user.save();

  teacher.user = user._id;
  await teacher.save();

  const verification = await issueEmailVerification({ user, req });

  recordActivity({
    module: MODULES.USERS,
    entityId: user._id,
    entityLabel: user.email,
    action: 'teacher_account_provisioned',
    description: `Teacher account created (email verification pending) for ${fullName}`,
    user: actor,
    req,
    meta: { teacherId: teacher._id, emailDelivered: verification.delivered }
  });

  return { user, verification };
}

/**
 * Finds an existing Parent by contact details or creates a new one, ensures a
 * linked parent User account exists, and links a child Student.
 * Parent details are stored once in the Parent record (not duplicated per child).
 */
async function provisionParentForGuardian({ guardian, student, actor, req } = {}) {
  if (!guardian || (!guardian.phone && !guardian.email && !guardian.name)) return null;

  const orClauses = [];
  if (guardian.phone) orClauses.push({ phone: guardian.phone });
  if (guardian.email) orClauses.push({ email: String(guardian.email).toLowerCase() });

  let parent = orClauses.length ? await Parent.findOne({ $or: orClauses }) : null;
  if (!parent) {
    parent = await Parent.create({
      name: guardian.name || 'Parent',
      relation: guardian.relation,
      phone: guardian.phone,
      email: guardian.email ? String(guardian.email).toLowerCase() : undefined,
      occupation: guardian.occupation,
      aadhaarNumber: guardian.aadhaarNumber || undefined,
      children: student?._id ? [student._id] : [],
      ...auditOnCreate(actor)
    });
  } else if (student?._id && !parent.children.some((id) => String(id) === String(student._id))) {
    parent.children.push(student._id);
    await parent.save();
  }

  // Ensure a parent User account always exists so the parent can access the
  // portal. Two supported login methods:
  //   - Email provided  -> verify email, then set password (email flow).
  //   - Only phone       -> log in with phone number + temporary password that
  //                         is returned to the admin, forced change on first login.
  let user = parent.user ? await User.findById(parent.user) : null;
  let credentials = null;

  if (!user) {
    const normalizedEmail = guardian.email ? String(guardian.email).toLowerCase() : null;
    const phone = guardian.phone ? String(guardian.phone) : null;

    // Reuse an existing account (e.g. a sibling's parent) by email or phone.
    if (normalizedEmail) user = await User.findOne({ email: normalizedEmail });
    if (!user && phone) user = await User.findOne({ username: phone, role: ROLES.PARENT });

    if (!user && (normalizedEmail || phone)) {
      const temporaryPassword = generateTemporaryPassword();
      if (normalizedEmail) {
        user = new User({
          name: guardian.name || 'Parent',
          email: normalizedEmail,
          username: phone || undefined,
          role: ROLES.PARENT,
          parent: parent._id,
          passwordHash: 'pending',
          mustChangePassword: true,
          isEmailVerified: false,
          emailVerificationRequired: true,
          ...auditOnCreate(actor)
        });
        await user.setPassword(temporaryPassword);
        await user.save();
        const verification = await issueEmailVerification({ user, req });
        credentials = {
          mode: 'email',
          email: normalizedEmail,
          username: phone || undefined,
          verificationEmailSent: verification.delivered
        };
      } else {
        // Phone-only login: username is the phone number.
        user = new User({
          name: guardian.name || 'Parent',
          email: `${phone}@parents.school-erp.local`,
          username: phone,
          role: ROLES.PARENT,
          parent: parent._id,
          passwordHash: 'pending',
          mustChangePassword: true,
          isTemporaryPassword: true,
          isEmailVerified: true,
          emailVerificationRequired: false,
          passwordExpiresAt: computePasswordExpiry(),
          ...auditOnCreate(actor)
        });
        await user.setPassword(temporaryPassword);
        await user.save();
        credentials = { mode: 'phone', username: phone, temporaryPassword };
      }
    }
  }

  if (user) {
    if (!parent.user) {
      parent.user = user._id;
      await parent.save();
    }
    // Keep the parent User's linkedStudents in sync so the portal shows all children.
    const linked = new Set((user.linkedStudents || []).map((id) => String(id)));
    if (student?._id) linked.add(String(student._id));
    user.linkedStudents = Array.from(linked);
    if (!user.linkedStudent && student?._id) user.linkedStudent = student._id;
    if (!user.parent) user.parent = parent._id;
    await user.save();
  }

  if (student?._id && !student.parent) {
    student.parent = parent._id;
    await student.save();
  }

  // If the parent account already existed (e.g. a sibling was admitted earlier),
  // we cannot re-show the original temporary password, but we still surface how
  // the parent logs in so the admin has the information.
  if (!credentials && user) {
    const isPlaceholderEmail = (user.email || '').endsWith('@parents.school-erp.local');
    credentials = {
      existing: true,
      mode: user.username ? 'phone' : 'email',
      username: user.username || undefined,
      email: isPlaceholderEmail ? undefined : user.email
    };
  }

  return { parent, user, credentials };
}

/**
 * Issues an email-verification token and emails the verification link.
 * @returns {{ token, link, delivered }}
 */
async function issueEmailVerification({ user, req } = {}) {
  const { rawToken } = await VerificationToken.issue({
    userId: user._id,
    type: 'email_verification',
    ttlMs: EMAIL_VERIFICATION_TTL_MS,
    ip: req?.ip
  });
  const result = await sendVerificationEmail({ to: user.email, name: user.name, token: rawToken });
  return { token: rawToken, link: result.link, delivered: result.delivered };
}

module.exports = {
  provisionStudentUser,
  provisionTeacherUser,
  provisionParentForGuardian,
  issueEmailVerification,
  generateTemporaryPassword,
  generateUniqueUsername
};
