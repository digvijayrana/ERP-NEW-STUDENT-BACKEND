const client = require('prom-client');
const { METRICS, SERVICE_NAME } = require('../constants');

const register = new client.Registry();
register.setDefaultLabels({ app: SERVICE_NAME });
client.collectDefaultMetrics({ register, prefix: METRICS.PREFIX });

const httpRequestDuration = new client.Histogram({
  name: `${METRICS.PREFIX}http_request_duration_seconds`,
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: METRICS.HISTOGRAM_BUCKETS
});
register.registerMetric(httpRequestDuration);

const httpRequestsTotal = new client.Counter({
  name: `${METRICS.PREFIX}http_requests_total`,
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});
register.registerMetric(httpRequestsTotal);

const httpRequestsInFlight = new client.Gauge({
  name: `${METRICS.PREFIX}http_requests_in_flight`,
  help: 'Number of HTTP requests currently being processed'
});
register.registerMetric(httpRequestsInFlight);

const dbQueryDuration = new client.Histogram({
  name: `${METRICS.PREFIX}db_query_duration_seconds`,
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'collection'],
  buckets: METRICS.HISTOGRAM_BUCKETS
});
register.registerMetric(dbQueryDuration);

const activeUsers = new client.Gauge({
  name: `${METRICS.PREFIX}active_users`,
  help: 'Number of authenticated users in recent requests',
  labelNames: ['role']
});
register.registerMetric(activeUsers);

const examGenerations = new client.Counter({
  name: `${METRICS.PREFIX}exam_generations_total`,
  help: 'Total number of AI exam generations',
  labelNames: ['provider', 'status']
});
register.registerMetric(examGenerations);

function normalizeRoute(req) {
  const route = req.route?.path || req.path || 'unknown';
  return route.replace(/\/[a-f0-9]{24}/g, '/:id');
}

function metricsMiddleware(req, res, next) {
  httpRequestsInFlight.inc();
  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const route = normalizeRoute(req);
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode
    };
    end(labels);
    httpRequestsTotal.inc(labels);
    httpRequestsInFlight.dec();

    if (req.user?.role) {
      activeUsers.set({ role: req.user.role }, 1);
    }
  });

  next();
}

module.exports = {
  register,
  metricsMiddleware,
  httpRequestDuration,
  httpRequestsTotal,
  dbQueryDuration,
  activeUsers,
  examGenerations
};
