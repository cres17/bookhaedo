import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
vi.mock('../server/day-alternatives', async (original) => {
  const module = await original<typeof import('../server/day-alternatives')>();
  return { ...module, dayContext: vi.fn(module.dayContext) };
});
vi.mock('../server/ai/tourism-graph', async (original) => ({
  ...(await original<typeof import('../server/ai/tourism-graph')>()),
  proposeTourism: vi.fn(),
}));
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
import { dayContext } from '../server/day-alternatives';
import { proposeTourism } from '../server/ai/tourism-graph';
import { PostgresRateLimitStore } from '../server/http/rate-limit';
const owner = request.agent(app),
  secondSession = request.agent(app),
  member = request.agent(app);
const emails = Array.from({ length: 2 }, () => `ai-limit-${randomUUID()}@example.test`);
const namespace = `ai-recommendation-test-${process.pid}`;
const store = new PostgresRateLimitStore(pool, namespace, 60_000);
let userIds: string[] = [];
const trips: string[] = [];
const endpoint = (index = 0) => `/api/trips/${trips[index]}/days/2026-10-01/ai-recommendations`;
beforeAll(async () => {
  await migrate();
  for (const [index, agent] of [owner, member].entries()) {
    const r = await agent
      .post('/api/auth/register')
      .send({ email: emails[index], name: '추천 제한 검증', password: 'ai-limit-password' });
    expect(r.status, r.body.error).toBe(201);
  }
  userIds = (
    await pool.query(
      'SELECT id FROM planner.app_user WHERE email=ANY($1::text[]) ORDER BY array_position($1::text[],email)',
      [emails],
    )
  ).rows.map((r) => r.id);
  expect(
    (
      await secondSession
        .post('/api/auth/login')
        .send({ email: emails[0], password: 'ai-limit-password' })
    ).status,
  ).toBe(200);
  for (let i = 0; i < 2; i++) {
    const r = await owner
      .post('/api/trips')
      .send({ title: '추천 호출 제한 검증', startDate: '2026-10-01', days: 1 });
    expect(r.status, r.body.error).toBe(201);
    trips.push(r.body.data.id);
  }
  await pool.query('INSERT INTO planner.trip_member(trip_id,user_id) VALUES($1,$2)', [
    trips[0],
    userIds[1],
  ]);
});
beforeEach(async () => {
  for (const id of userIds) await store.resetKey(id);
  vi.clearAllMocks();
});
afterAll(async () => {
  for (const id of userIds) await store.resetKey(id);
  await pool.query('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [emails]);
  await pool.end();
});
it('allows 30 real authenticated POSTs and rejects the next 10 before day lookup or graph execution', async () => {
  for (let i = 0; i < 30; i++) {
    const r = await owner.post(endpoint()).send({});
    expect(r.status, `request ${i + 1}: ${r.body.error}`).toBe(200);
    expect(r.body.status).toBe('NEEDS_ANCHOR');
  }
  vi.clearAllMocks();
  for (let i = 0; i < 10; i++) {
    const r = await owner.post(endpoint()).send({ strategy: 'NEARBY' });
    expect(r.status, `request ${i + 31}: ${r.body.error}`).toBe(429);
    expect(r.body).toMatchObject({
      code: 'AI_RECOMMENDATION_RATE_LIMITED',
      error: '추천 요청이 많아요. 잠시 후 다시 조회해주세요.',
      requestId: r.headers['x-request-id'],
    });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(r.headers.ratelimit).toMatch(/limit=30, remaining=0/);
    expect(r.headers['ratelimit-policy']).toBe('30;w=60');
  }
  expect(dayContext).not.toHaveBeenCalled();
  expect(proposeTourism).not.toHaveBeenCalled();
  expect((await owner.get('/api/trips/' + trips[0])).body.data.days[0].items).toEqual([]);
});
it('shares quota across sessions and trips, isolates accepted members and keeps GET provider quota independent', async () => {
  for (let i = 0; i < 30; i++) {
    const agent = i % 2 ? secondSession : owner;
    expect((await agent.post(endpoint(i % 2)).send({})).status).toBe(200);
  }
  expect((await owner.post(endpoint()).send({})).status).toBe(429);
  expect((await secondSession.post(endpoint(1)).send({})).status).toBe(429);
  const otherUser = await member.post(endpoint()).send({});
  expect(otherUser.status).toBe(200);
  expect(otherUser.headers.ratelimit).toMatch(/limit=30, remaining=29/);
  const get = await owner.get(`/api/trips/${trips[0]}/days/2026-10-01/routes`);
  expect(get.status).toBe(200);
  expect(get.headers.ratelimit).toMatch(/limit=30, remaining=29/);
});
it('starts a fresh allowance after the PostgreSQL window expires', async () => {
  for (let i = 0; i < 30; i++) expect((await owner.post(endpoint()).send({})).status).toBe(200);
  expect((await owner.post(endpoint()).send({})).status).toBe(429);
  // Only this test user's bucket exists in this process-specific recommendation namespace.
  await pool.query(
    "UPDATE planner.rate_limit_bucket SET reset_at=clock_timestamp()-interval '1 second' WHERE namespace=$1",
    [namespace],
  );
  const r = await owner.post(endpoint()).send({});
  expect(r.status).toBe(200);
  expect(r.headers.ratelimit).toMatch(/limit=30, remaining=29/);
});
