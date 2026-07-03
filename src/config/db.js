const mongoose = require('mongoose');
const { createLogger } = require('../utils/logger');

const log = createLogger('database');

async function connectDb() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/student_erp';
  mongoose.set('strictQuery', true);
  mongoose.connection.on('error', (error) => {
    log.error('MongoDB connection error', { error: error.message });
  });
  mongoose.connection.on('disconnected', () => {
    log.warn('MongoDB disconnected');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: true
  });

  log.info('MongoDB connected successfully', { database: mongoose.connection.name });
  return mongoose.connection;
}

module.exports = connectDb;
