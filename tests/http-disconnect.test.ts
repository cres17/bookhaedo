import express from 'express';
import { recommendationRequestBudget, abortable } from '../server/operation-budget';
import { requestContext, errorHandler } from '../server/http/middleware';
import { createServer, get } from 'node:http';
import { once } from 'node:events';
import { afterAll, afterEach, expect, it } from 'vitest';
import {
  observeRequests,
  renderMetrics,
  resetMetricsForTest,
} from '../server/observability/metrics';
import { pool } from '../server/db';
afterAll(() => pool.end());
afterEach(resetMetricsForTest);
it('releases the in-flight gauge on real HTTP disconnect without counting a successful response', async () => {
  let entered!: () => void, closed!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    ended = new Promise<void>((r) => (closed = r));
  let budget: ReturnType<typeof recommendationRequestBudget>;
  const server = createServer((req: any, res: any) => {
    res.locals = {};
    budget = recommendationRequestBudget(req, res);
    observeRequests(req, res, () => {
      res.once('close', closed);
      entered();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = get(`http://127.0.0.1:${(server.address() as any).port}/api/disconnect`);
  client.on('error', () => {});
  try {
    await started;
    client.destroy();
    await ended;
    expect(budget!.signal.aborted).toBe(true);
    expect(renderMetrics()).toContain('bookhaedo_http_requests_in_flight 0');
    expect(renderMetrics()).not.toContain('status="200"');
    expect(renderMetrics()).toContain('bookhaedo_http_aborted_requests_total');
  } finally {
    client.destroy();
    server.close();
    await once(server, 'close');
  }
});
it('decrements only once for finish followed by close', async () => {
  const server = createServer((req: any, res: any) => {
    res.locals = {};
    observeRequests(req, res, () => res.end('ok'));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/finish`);
    await response.text();
    expect(renderMetrics()).toContain('bookhaedo_http_requests_in_flight 0');
    expect(renderMetrics()).toContain('status="200"');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

it('returns a traced no-store 504 when the whole read-only request exceeds its deadline', async () => {
  const app = express();
  app.use(requestContext, observeRequests);
  let aborted = false;
  app.get('/slow', (req, res, next) => {
    const budget = recommendationRequestBudget(req, res, 30);
    budget.signal.addEventListener('abort', () => (aborted = true));
    void abortable(() => new Promise(() => {}), budget.signal).then(
      () => res.end('unexpected'),
      next,
    );
  });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/slow`);
    expect(response.status).toBe(504);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.code).toBe('REQUEST_DEADLINE_EXCEEDED');
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
    expect(aborted).toBe(true);
    expect(renderMetrics()).toContain('bookhaedo_http_requests_in_flight 0');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
