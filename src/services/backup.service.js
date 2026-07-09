const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const complianceConfig = require('../config/compliance.config');
const { getConfiguration } = require('./governanceConfig.service');
const { getStorageInfo } = require('./documentStorage.service');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');

const log = createLogger('backup');

function backupRoot() {
  return path.resolve(process.cwd(), complianceConfig.backup.outputDir);
}

function ensureBackupDir() {
  const root = backupRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function timestampLabel(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function exportCollection(Model, label) {
  const rows = await Model.find({}).lean();
  return { label, count: rows.length, data: rows };
}

async function createBackup(user) {
  const startedAt = new Date();
  const root = ensureBackupDir();
  const folder = path.join(root, timestampLabel(startedAt));
  fs.mkdirSync(folder, { recursive: true });

  const config = await getConfiguration();
  fs.writeFileSync(path.join(folder, 'governance-config.json'), JSON.stringify(config, null, 2));

  const collections = await Promise.all([
    exportCollection(Student, 'students'),
    exportCollection(Teacher, 'teachers')
  ]);

  for (const entry of collections) {
    fs.writeFileSync(
      path.join(folder, `${entry.label}.json`),
      JSON.stringify({ exportedAt: startedAt.toISOString(), count: entry.count, data: entry.data }, null, 2)
    );
  }

  const manifest = {
    createdAt: startedAt.toISOString(),
    createdBy: user?.email || 'system',
    storage: getStorageInfo(),
    collections: collections.map((entry) => ({ label: entry.label, count: entry.count })),
    includesConfiguration: true
  };
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));

  pruneOldBackups();
  log.info('Backup completed', { folder, collections: manifest.collections });
  return { folder, manifest };
}

function pruneOldBackups() {
  const root = backupRoot();
  if (!fs.existsSync(root)) return;
  const retentionMs = complianceConfig.backup.retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(root, entry.name);
    const manifestPath = path.join(fullPath, 'manifest.json');
    let createdAt = fs.statSync(fullPath).mtimeMs;
    if (fs.existsSync(manifestPath)) {
      try {
        createdAt = new Date(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).createdAt).getTime();
      } catch {
        // keep stat fallback
      }
    }
    if (createdAt < cutoff) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      log.info('Pruned old backup', { folder: entry.name });
    }
  }
}

function listBackups(limit = 20) {
  const root = backupRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folder = path.join(root, entry.name);
      const manifestPath = path.join(folder, 'manifest.json');
      let manifest = null;
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch {
          manifest = null;
        }
      }
      return {
        id: entry.name,
        path: folder,
        createdAt: manifest?.createdAt || fs.statSync(folder).mtime.toISOString(),
        collections: manifest?.collections || [],
        verified: !!manifest
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

module.exports = {
  createBackup,
  listBackups,
  pruneOldBackups
};
