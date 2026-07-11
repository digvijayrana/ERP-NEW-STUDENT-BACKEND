require('dotenv').config();

/**
 * Safe, idempotent backfill for the normalized auth/data model.
 *
 * What it does (only for records missing the new links):
 *  - Creates a normalized Parent record from each Student's primary guardian and
 *    links Student.parent + Parent.children (de-duplicating parents by phone/email).
 *  - Links Parent.user / User.parent for existing parent User accounts whose
 *    linkedStudents overlap, and syncs each parent User's linkedStudents so the
 *    Parent Portal shows ALL children.
 *
 * What it intentionally does NOT do:
 *  - It does not create student/teacher login accounts or generate passwords
 *    (those are auto-provisioned for NEW records; issuing credentials for the
 *    entire existing base is an explicit admin action).
 *  - It does not send any emails.
 *
 * Usage:
 *   node src/scripts/migrateAuthModel.js            # dry-run (reports only)
 *   node src/scripts/migrateAuthModel.js --commit   # apply changes
 */

const connectDb = require('../config/db');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const User = require('../models/User');
const { ROLES } = require('../constants');

const COMMIT = process.argv.includes('--commit');

function log(...args) {
  console.log(...args);
}

async function findOrCreateParent(guardian, studentId, stats) {
  const orClauses = [];
  if (guardian.phone) orClauses.push({ phone: guardian.phone });
  if (guardian.email) orClauses.push({ email: String(guardian.email).toLowerCase() });

  let parent = orClauses.length ? await Parent.findOne({ $or: orClauses }) : null;
  if (parent) {
    if (!parent.children.some((id) => String(id) === String(studentId))) {
      parent.children.push(studentId);
      if (COMMIT) await parent.save();
    }
    return parent;
  }

  stats.parentsCreated += 1;
  if (!COMMIT) return { _id: null, children: [studentId] };

  parent = await Parent.create({
    name: guardian.name || 'Parent',
    relation: guardian.relation,
    phone: guardian.phone,
    email: guardian.email ? String(guardian.email).toLowerCase() : undefined,
    occupation: guardian.occupation,
    aadhaarNumber: guardian.aadhaarNumber || undefined,
    children: [studentId]
  });
  return parent;
}

async function run() {
  await connectDb();
  log(`\n=== Auth model migration (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===\n`);

  const stats = {
    studentsScanned: 0,
    studentsLinked: 0,
    parentsCreated: 0,
    parentUsersLinked: 0,
    parentUserChildrenSynced: 0
  };

  const students = await Student.find({}).select('firstName lastName guardians parent');
  for (const student of students) {
    stats.studentsScanned += 1;
    if (student.parent) continue;
    const guardians = student.guardians || [];
    const primary = guardians.find((g) => g.isPrimary) || guardians[0];
    if (!primary) continue;

    const parent = await findOrCreateParent(primary, student._id, stats);
    if (parent?._id) {
      student.parent = parent._id;
      stats.studentsLinked += 1;
      if (COMMIT) await student.save();
    } else {
      stats.studentsLinked += 1; // would link on commit
    }
  }

  // Link existing parent User accounts to Parent records + sync linkedStudents.
  const parentUsers = await User.find({ role: ROLES.PARENT });
  for (const user of parentUsers) {
    const childIds = user.linkedStudents?.length
      ? user.linkedStudents
      : user.linkedStudent ? [user.linkedStudent] : [];
    if (!childIds.length) continue;

    // Find the Parent record that owns any of these children.
    const parent = await Parent.findOne({ children: { $in: childIds } });
    if (!parent) continue;

    let changed = false;
    if (!parent.user) {
      parent.user = user._id;
      changed = true;
    }
    // Ensure all of the Parent's children are reflected on the user (all-children portal).
    const merged = new Set([...childIds.map(String), ...parent.children.map(String)]);
    if (merged.size !== childIds.length) {
      user.linkedStudents = Array.from(merged);
      if (!user.linkedStudent) user.linkedStudent = user.linkedStudents[0];
      stats.parentUserChildrenSynced += 1;
      if (COMMIT) await user.save();
    }
    if (!user.parent) {
      user.parent = parent._id;
      if (COMMIT) await user.save();
    }
    if (changed) {
      stats.parentUsersLinked += 1;
      if (COMMIT) await parent.save();
    }
  }

  log('Results:');
  log(JSON.stringify(stats, null, 2));
  log(`\n${COMMIT ? 'Changes applied.' : 'Dry-run complete. Re-run with --commit to apply.'}\n`);
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
