require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const { createLogger } = require('./utils/logger');
const {
  DEFAULTS,
  HTTP_STATUS,
  RATE_LIMIT,
  SERVICE_NAME
} = require('./constants');

const log = createLogger('app');
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({
  origin: [
    process.env.CLIENT_URL || DEFAULTS.CLIENT_URL,
    DEFAULTS.DEV_CLIENT_URL
  ],
  credentials: true
}));
app.use(express.json({ limit: DEFAULTS.BODY_SIZE_LIMIT }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: (message) => log.info(message.trim(), { source: 'morgan' }) }
}));
app.use('/api/auth/login', rateLimit({
  windowMs: RATE_LIMIT.LOGIN_WINDOW_MS,
  max: RATE_LIMIT.LOGIN_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again later.' }
}));
app.use('/api', rateLimit({
  windowMs: RATE_LIMIT.API_WINDOW_MS,
  max: Number(process.env.RATE_LIMIT_MAX || DEFAULTS.RATE_LIMIT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' }
}));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/health', (_req, res) => res.json({
  ok: true,
  service: SERVICE_NAME,
  timestamp: new Date().toISOString()
}));
app.use('/api', routes);
app.use((_req, res) => res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Route not found' }));
app.use(errorHandler);

module.exports = app;
