/**
 * Migration: Fee structure → class-level (shared by all sections)
 *
 * Before: FeeStructure was keyed by (academicYear, classRoom) — one per section.
 * After:  FeeStructure is keyed by (academicYear, className) — one per class,
 *         and ClassRoom.feeStructure points at that shared document.
 *
 * Idempotent. Safe to re-run.
 *
 * Usage (from backend/):
 *   node src/scripts/migrateFeeStructureClassName.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const FeeStructure = require('../models/FeeStructure');
const ClassRoom = require('../models/ClassRoom');

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI (or MONGO_URI) is not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected. Migrating fee structures to class-level…');

  const structures = await FeeStructure.find({}).lean();
  let backfilled = 0;
  let consolidated = 0;
  let linked = 0;

  // Group legacy section-specific structures by (academicYear, className).
  const groups = new Map();

  for (const structure of structures) {
    let className = structure.className ? String(structure.className).trim() : '';

    if (!className && structure.classRoom) {
      const room = await ClassRoom.findById(structure.classRoom).select('name').lean();
      className = room?.name ? String(room.name).trim() : '';
      if (className) {
        await FeeStructure.updateOne({ _id: structure._id }, { $set: { className } });
        backfilled += 1;
      }
    }

    if (!className) {
      console.warn(`Skipping structure ${structure._id}: cannot resolve className`);
      continue;
    }

    const key = `${structure.academicYear}::${className}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...structure, className });
  }

  for (const [key, list] of groups.entries()) {
    const [academicYear, className] = key.split('::');

    // Prefer an already-class-level doc (no classRoom); otherwise keep the newest.
    const preferred =
      list.find((item) => !item.classRoom) ||
      [...list].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];

    // Ensure the preferred doc carries className and drops the section-only unique key.
    await FeeStructure.updateOne(
      { _id: preferred._id },
      { $set: { className }, $unset: { classRoom: '' } }
    );

    // Delete duplicate section-specific structures for the same class + year.
    const dupes = list.filter((item) => String(item._id) !== String(preferred._id));
    if (dupes.length) {
      await FeeStructure.deleteMany({ _id: { $in: dupes.map((item) => item._id) } });
      consolidated += dupes.length;
    }

    // Link every section of this class + year to the preferred structure and
    // stamp monthly tuition from its tuition component(s).
    const monthlyFee = (preferred.components || [])
      .filter((component) => component.key === 'tuition')
      .reduce((sum, component) => {
        const factor = { monthly: 1, quarterly: 1 / 3, half_yearly: 1 / 6, yearly: 1 / 12, one_time: 0 }[
          component.frequency
        ] ?? 1;
        return sum + Math.max(Number(component.amount) || 0, 0) * factor;
      }, 0);

    const result = await ClassRoom.updateMany(
      { academicYear, name: className },
      { $set: { feeStructure: preferred._id, monthlyFee: Math.round(monthlyFee) } }
    );
    linked += result.modifiedCount || 0;
  }

  console.log(`Backfilled className on ${backfilled} structure(s).`);
  console.log(`Removed ${consolidated} duplicate section-specific structure(s).`);
  console.log(`Linked / refreshed ${linked} class section(s).`);
  console.log('Done.');
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
