import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import { pool } from '../db.js';
import { logger } from './logger.js';
import { providerCaches } from '../provider-cache.js';

const operations = {
  tripRead: '/api/trips/:id',
  dayRead: '/api/trips/:id/days/:date/day-alternatives',
  dayWrite: '/api/trips/:id/days/:date/day-alternatives',
  weatherRead: '/api/trips/:id/days/:date/weather-alternatives',
  weatherWrite: '/api/trips/:id/days/:date/weather-alternatives',
  aiRead: '/api/trips/:id/days/:date/ai-recommendations',
} as const;
export const operation =
  (id: keyof typeof operations): RequestHandler =>
  (_req, res, next) => {
    res.locals.metricOperation = operations[id];
    next();
  };

const durationBuckets = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const requests = new Map<string, number>();
const aborted = new Map<string, number>();
const durations = new Map<string, number[]>();
let inFlight = 0;

export function routeLabel(path: string) {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d{4}-\d{2}-\d{2}(?=\/|$)/g, '/:date')
    .replace(/\/\d+(?=\/|$)/g, '/:number')
    .slice(0, 160);
}

const metricKey = (method: string, route: string, status: number) =>
  `${method}\0${route}\0${status}`;

export const observeRequests: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  inFlight++;
  let finalized = false;
  const finalize = (completed: boolean) => {
    if (finalized) return;
    finalized = true;
    res.off('finish', finish);
    res.off('close', close);
    inFlight--;
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const matchedRoute = typeof req.route?.path === 'string' ? req.route.path : undefined;
    const route = Object.values(operations).includes(res.locals.metricOperation)
      ? res.locals.metricOperation
      : matchedRoute
        ? routeLabel(matchedRoute)
        : '/api/:unmatched';
    if (!completed) {
      const key = `${req.method}\0${route}`;
      aborted.set(key, (aborted.get(key) || 0) + 1);
      return;
    }
    const key = metricKey(req.method, route, res.statusCode);
    requests.set(key, (requests.get(key) || 0) + 1);
    const counts = durations.get(key) || Array(durationBuckets.length + 2).fill(0);
    durationBuckets.forEach((bucket, index) => {
      if (seconds <= bucket) counts[index]++;
    });
    counts[durationBuckets.length] += seconds;
    counts[durationBuckets.length + 1]++;
    durations.set(key, counts);
    const sampleRate = Number(
      process.env.HTTP_LOG_SAMPLE_RATE ?? (process.env.NODE_ENV === 'production' ? '0.1' : '1'),
    );
    if (res.statusCode >= 500 || seconds >= 1 || Math.random() < sampleRate)
      logger.info('HTTP_REQUEST', {
        requestId: res.locals.requestId,
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: Math.round(seconds * 1000),
      });
  };
  const finish = () => finalize(true);
  const close = () => finalize(res.writableFinished);
  res.once('finish', finish);
  res.once('close', close);
  next();
};

const labels = (key: string) => {
  const [method, route, status] = key.split('\0');
  return `method="${method}",route="${route}",status="${status}"`;
};

export function renderMetrics(database: Pool = pool) {
  const lines = [
    '# HELP bookhaedo_http_requests_total Completed HTTP requests.',
    '# TYPE bookhaedo_http_requests_total counter',
  ];
  for (const [key, value] of requests)
    lines.push(`bookhaedo_http_requests_total{${labels(key)}} ${value}`);
  lines.push(
    '# HELP bookhaedo_http_aborted_requests_total HTTP requests closed before completion.',
    '# TYPE bookhaedo_http_aborted_requests_total counter',
  );
  for (const [key, value] of aborted) {
    const [method, route] = key.split('\0');
    lines.push(
      `bookhaedo_http_aborted_requests_total{method="${method}",route="${route}"} ${value}`,
    );
  }
  lines.push(
    '# HELP bookhaedo_http_request_duration_seconds HTTP request duration.',
    '# TYPE bookhaedo_http_request_duration_seconds histogram',
  );
  for (const [key, values] of durations) {
    durationBuckets.forEach((bucket, index) =>
      lines.push(
        `bookhaedo_http_request_duration_seconds_bucket{${labels(key)},le="${bucket}"} ${values[index]}`,
      ),
    );
    lines.push(
      `bookhaedo_http_request_duration_seconds_bucket{${labels(key)},le="+Inf"} ${values[durationBuckets.length + 1]}`,
      `bookhaedo_http_request_duration_seconds_sum{${labels(key)}} ${values[durationBuckets.length]}`,
      `bookhaedo_http_request_duration_seconds_count{${labels(key)}} ${values[durationBuckets.length + 1]}`,
    );
  }
  lines.push(
    '# TYPE bookhaedo_http_requests_in_flight gauge',
    `bookhaedo_http_requests_in_flight ${inFlight}`,
    '# TYPE bookhaedo_db_pool_total gauge',
    `bookhaedo_db_pool_total ${database.totalCount}`,
    '# TYPE bookhaedo_db_pool_idle gauge',
    `bookhaedo_db_pool_idle ${database.idleCount}`,
    '# TYPE bookhaedo_db_pool_waiting gauge',
    `bookhaedo_db_pool_waiting ${database.waitingCount}`,
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${process.uptime()}`,
    '# TYPE process_resident_memory_bytes gauge',
    `process_resident_memory_bytes ${process.memoryUsage().rss}`,
  );
  lines.push(
    '# TYPE bookhaedo_provider_cache_total counter',
    '# TYPE bookhaedo_provider_load_duration_seconds_total counter',
  );
  for (const [provider, cache] of Object.entries(providerCaches)) {
    for (const outcome of ['hit', 'miss', 'joined', 'failed', 'bypass'] as const)
      lines.push(
        `bookhaedo_provider_cache_total{provider="${provider}",outcome="${outcome}"} ${cache.stats[outcome]}`,
      );
    lines.push(
      `bookhaedo_provider_load_duration_seconds_total{provider="${provider}"} ${cache.stats.durationMs / 1000}`,
    );
  }
  return lines.join('\n') + '\n';
}

function validToken(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const metricsEndpoint: RequestHandler = (req, res) => {
  const expected = process.env.METRICS_TOKEN || '';
  const actual = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (process.env.NODE_ENV === 'production' && (!expected || !validToken(actual, expected)))
    return res.status(401).json({ error: '관측 지표 인증이 필요합니다.' });
  res.type('text/plain; version=0.0.4').send(renderMetrics());
};

export function resetMetricsForTest() {
  requests.clear();
  aborted.clear();
  durations.clear();
  inFlight = 0;
}
