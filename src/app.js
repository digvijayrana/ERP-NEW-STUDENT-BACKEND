require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const mongoose = require('mongoose');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const tenantContext = require('./middleware/tenantContext');
const { createRedisStore } = require('./middleware/rateLimitStore');
const { createLogger } = require('./utils/logger');
const { register, metricsMiddleware } = require('./utils/metrics');
const { poolStats } = require('./services/tenantConnection.manager');
const {
  DEFAULTS,
  HTTP_STATUS,
  RATE_LIMIT,
  SERVICE_NAME
} = require('./constants');

const log = createLogger('app');
const app = express();

app.disable('x-powered-by');
// Direct browser → API by default (set TRUST_PROXY only if you add a reverse proxy later)
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.ADMIN_CLIENT_URL,
  'https://erpms.vercel.app',
  DEFAULTS.CLIENT_URL,
  DEFAULTS.DEV_CLIENT_URL
].filter(Boolean);

// Allow any https://*.ROOT_DOMAIN origin in production gateway mode
const rootDomain = (process.env.ROOT_DOMAIN || '').toLowerCase();
function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, '');
  if (allowedOrigins.includes(normalized)) return true;
  if (rootDomain) {
    try {
      const { hostname, protocol } = new URL(normalized);
      if (protocol === 'https:' && (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`))) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

const corsStrict = String(process.env.CORS_STRICT || process.env.NODE_ENV === 'production').toLowerCase() !== 'false';

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    log.warn('CORS blocked request', { origin });
    if (corsStrict) {
      callback(new Error(`CORS origin not allowed: ${origin}`));
    } else {
      callback(null, true);
    }
  },
  credentials: true
}));

app.use(express.json({ limit: DEFAULTS.BODY_SIZE_LIMIT }));
app.use(express.urlencoded({ extended: true }));

const { masterRecordGuard } = require('./middleware/masterRecordGuard');
app.use(masterRecordGuard);
app.use(tenantContext);
app.use(metricsMiddleware);
app.use(requestLogger);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: (message) => log.info(message.trim(), { source: 'morgan' }) }
}));

const loginStore = createRedisStore(RATE_LIMIT.LOGIN_WINDOW_MS);
const apiStore = createRedisStore(RATE_LIMIT.API_WINDOW_MS);

app.use(
  ['/api/auth/login', '/api/erp/auth/login', '/api/admin/auth/login'],
  rateLimit({
    windowMs: RATE_LIMIT.LOGIN_WINDOW_MS,
    max: RATE_LIMIT.LOGIN_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    store: loginStore,
    message: { message: 'Too many login attempts. Please try again later.' }
  })
);
// Covers /api, /api/erp, /api/admin (all share the /api prefix)
app.use('/api', rateLimit({
  windowMs: RATE_LIMIT.API_WINDOW_MS,
  max: Number(process.env.RATE_LIMIT_MAX || DEFAULTS.RATE_LIMIT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  store: apiStore,
  message: { message: 'Too many requests. Please slow down.' }
}));

/** Liveness — process is up (ALB/K8s livenessProbe) */
app.get('/health', (_req, res) => res.json({
  ok: true,
  service: SERVICE_NAME,
  timestamp: new Date().toISOString()
}));

/** Readiness — Mongo reachable (ALB/K8s readinessProbe) */
app.get('/ready', (_req, res) => {
  const dbOk = mongoose.connection.readyState === 1;
  const body = {
    ok: dbOk,
    service: SERVICE_NAME,
    mongo: dbOk ? 'up' : 'down',
    tenant: poolStats(),
    timestamp: new Date().toISOString()
  };
  res.status(dbOk ? 200 : 503).json(body);
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Canonical API
app.use('/api', routes);
// Gateway path aliases (Nginx may also rewrite; aliases keep direct access working)
app.use('/api/erp', routes);
app.use('/api/admin', routes);

app.use((_req, res) => res.status(HTTP_STATUS.NOT_FOUND).json({ message: 'Route not found' }));
app.use(errorHandler);

module.exports = app;
