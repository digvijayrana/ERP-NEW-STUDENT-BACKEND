const mongoose = require('mongoose');
const { createLogger } = require('../utils/logger');
const { DEFAULTS, DB } = require('../constants');

const log = createLogger('database');

async function connectDb() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const uri = process.env.MONGODB_URI || DEFAULTS.MONGODB_URI;
  mongoose.set('strictQuery', true);
  mongoose.connection.on('error', (error) => {
    log.error('MongoDB connection error', { error: error.message });
  });
  mongoose.connection.on('disconnected', () => {
    log.warn('MongoDB disconnected');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: DB.SERVER_SELECTION_TIMEOUT_MS,
    autoIndex: true
  });

  const { ensureDefaultRoles } = require('../services/permission.service');
  await ensureDefaultRoles();

  log.info('MongoDB connected successfully', { database: mongoose.connection.name });
  return mongoose.connection;
}

module.exports = connectDb;
