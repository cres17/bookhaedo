import { afterEach, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../server/app';
import { renderMetrics, resetMetricsForTest, routeLabel } from '../server/observability/metrics';

afterEach(resetMetricsForTest);

it('metrics use bounded route labels and never include query values', async () => {
  await request(app).get('/api/health/live?token=do-not-record');
  const metrics = renderMetrics();
  expect(metrics).toContain('route="/api/health/live"');
  expect(metrics).not.toContain('do-not-record');
  expect(metrics).toContain('bookhaedo_db_pool_waiting');
  expect(metrics).toContain('bookhaedo_provider_cache_total{provider="weather",outcome="hit"}');
  expect(metrics).toContain('bookhaedo_provider_load_duration_seconds_total');
  expect(routeLabel('/trips/56b1c581-8510-4efe-b080-7e6f54a6d0aa/days/2026-10-10')).toBe(
    '/trips/:id/days/:date',
  );
});

it('development metrics endpoint emits Prometheus text', async () => {
  const response = await request(app).get('/internal/metrics');
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/plain');
  expect(response.text).toContain('bookhaedo_http_requests_total');
});

it('production metrics require the configured bearer token', async () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousToken = process.env.METRICS_TOKEN;
  process.env.NODE_ENV = 'production';
  process.env.METRICS_TOKEN = 'm'.repeat(32);
  try {
    expect((await request(app).get('/internal/metrics')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/internal/metrics')
          .set('Authorization', `Bearer ${'m'.repeat(32)}`)
      ).status,
    ).toBe(200);
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    if (previousToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = previousToken;
  }
});
