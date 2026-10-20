import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
vi.mock('../server/providers', async (original) => ({
  ...(await original<any>()),
  forecast: vi.fn(async () => ({ available: false, notice: '예보 범위 밖' })),
}));
vi.mock('../server/routing', async (original) => ({
  ...(await original<any>()),
  routeSegment: vi.fn(async (a: any, b: any) => ({
    from: a.id,
    to: b.id,
    source: 'straight-line',
    distanceMeters: 1200,
    durationSeconds: null,
  })),
}));
// These cases intentionally exercise the no-knowledge fallback. Keep real DB candidates,
// authentication and confirmation, but isolate knowledge absence from local published data.
vi.mock('../server/tourism-search', async (original) => {
  const module = await original<any>();
  return {
    ...module,
    searchTourism: vi.fn(async (input: any) => ({
      ...(await module.searchTourism(input)),
      evidence: [],
      snapshotIds: [],
      referenceEvents: [],
    })),
  };
});
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
const owner = request.agent(app),
  member = request.agent(app),
  outsider = request.agent(app);
const emails = Array.from({ length: 3 }, () => `tourism-${randomUUID()}@example.test`);
let tripId = '';
let ids: string[] = [];
let savedIds: string[] = [];
const fixtureIds = Array.from({ length: 5 }, () => randomUUID());
const base = () => `/api/trips/${tripId}/days/2026-10-01`;
beforeAll(async () => {
  await migrate();
  for (const [i, agent] of [owner, member, outsider].entries())
    expect(
      (
        await agent
          .post('/api/auth/register')
          .send({ email: emails[i], name: '관광 추천 QA', password: 'tourism-password' })
      ).status,
    ).toBe(201);
  tripId = (
    await owner
      .post('/api/trips')
      .send({ title: '공개 자료 추천', startDate: '2026-10-01', days: 1 })
  ).body.data.id;
  for (const [index, id] of fixtureIds.entries()) {
    await pool.query(
      `INSERT INTO geo_data.place(id,region_id,category,name_ja,name_ko,normalized_name,latitude,longitude,location,region_distance_km,osm_tags)
      VALUES($1,'sapporo','ATTRACTION',$2,$2,$1,$3,141.35,ST_SetSRID(ST_MakePoint(141.35,$3),4326)::geography,0,'{"tourism":"museum"}')`,
      [id, '観光QA' + id, 43.06 + index * 0.001],
    );
  }
  ids = fixtureIds.slice(0, 2);
  expect(
    (await owner.put(base() + '/items').send({ expectedRevision: 0, placeIds: ids })).status,
  ).toBe(200);
  await pool.query(
    'INSERT INTO planner.trip_member(trip_id,user_id) SELECT $1,id FROM planner.app_user WHERE email=$2',
    [tripId, emails[1]],
  );
});
afterAll(async () => {
  await pool.query('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [emails]);
  await pool.query('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [fixtureIds]);
  await pool.end();
});
it('requires authenticated owner/accepted member before running the graph', async () => {
  expect(
    (
      await request(app)
        .post(base() + '/ai-recommendations')
        .send({})
    ).status,
  ).toBe(401);
  expect((await outsider.post(base() + '/ai-recommendations').send({})).status).toBe(404);
  expect((await member.post(base() + '/ai-recommendations').send({ count: 3 })).status).toBe(200);
});
it('rejects spoofed identity, arbitrary URLs, excessive requests and invalid keep-place constraints', async () => {
  for (const bad of [
    { userId: 'attacker' },
    { url: 'http://127.0.0.1' },
    { count: 9 },
    { keepPlaceIds: [randomUUID()] },
  ])
    expect((await owner.post(base() + '/ai-recommendations').send(bad)).status).toBe(400);
});
it('returns a read-only fallback, keeps selected stops and leaves missing route time unknown', async () => {
  const r = await owner
    .post(base() + '/ai-recommendations')
    .send({ count: 3, keepPlaceIds: [ids[0]], strategy: 'NEARBY' });
  expect(r.status).toBe(200);
  expect(r.body.engine).toBe('langgraph');
  expect(r.body.generationMode).toBe('rules');
  expect(r.body.status).toBe('CATALOG_FALLBACK');
  expect(r.body.preview.complete).toBe(false);
  expect(r.body.preview.durationSeconds).toBeNull();
  expect(r.body.preview.plan.places[0].id).toBe(ids[0]);
  expect(r.body.expectedRevision).toBe(1);
  savedIds = r.body.preview.plan.places.map((p: any) => p.id);
  expect(
    (await owner.get('/api/trips/' + tripId)).body.data.days[0].items.map((p: any) => p.id),
  ).toEqual(ids);
  expect(JSON.stringify(r.body)).not.toMatch(/password_hash|token_hash|kita_session/);
});
it('reuses the confirmation API and preserves 428/409 conflict behavior', async () => {
  const endpoint = base() + '/day-alternatives';
  expect(
    (await owner.patch(endpoint).send({ placeIds: savedIds, expectedPlaceIds: ids })).status,
  ).toBe(428);
  expect(
    (
      await owner
        .patch(endpoint)
        .send({ placeIds: savedIds, expectedPlaceIds: ids, expectedRevision: 0 })
    ).status,
  ).toBe(409);
  const result = await member
    .patch(endpoint)
    .send({ placeIds: savedIds, expectedPlaceIds: ids, expectedRevision: 1 });
  expect(result.status).toBe(200);
  expect(result.body.revision).toBe(2);
  expect(
    (
      await owner
        .patch(endpoint)
        .send({ placeIds: ids, expectedPlaceIds: savedIds, expectedRevision: 1 })
    ).status,
  ).toBe(409);
});

it('invalid confirmation counts do not leak database connections', async () => {
  for (let i = 0; i < 3; i++)
    expect(
      (await owner.patch(base() + '/day-alternatives').send({ placeIds: [], expectedPlaceIds: [] }))
        .status,
    ).toBe(400);
  expect(pool.idleCount).toBe(pool.totalCount);
});

it('returns complete non-cacheable metadata for a day without an anchor', async () => {
  const created = await owner
    .post('/api/trips')
    .send({ title: 'empty tourism', startDate: '2026-10-01', days: 1 });
  expect(created.status, created.body.error).toBe(201);
  const trip = created.body.data.id;
  const r = await owner
    .post(`/api/trips/${trip}/days/2026-10-01/ai-recommendations`)
    .send({ strategy: 'NEARBY' });
  expect(r.status).toBe(200);
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.body.requestId).toBe(r.headers['x-request-id']);
  expect(r.body).toMatchObject({
    status: 'NEEDS_ANCHOR',
    tripId: trip,
    date: '2026-10-01',
    expectedRevision: 0,
    expectedPlaceIds: [],
    snapshotIds: [],
    engine: 'langgraph',
    generationMode: 'rules',
    searchAttempts: 0,
    weather: { available: false },
    weatherMode: 'UNKNOWN',
    plans: [],
    preview: null,
    evidence: [],
    warnings: [],
  });
});
it('distinguishes an unavailable strategy from empty or rejected plans', async () => {
  const unavailable = await owner
    .post(base() + '/ai-recommendations')
    .send({ strategy: 'KNOWLEDGE' });
  expect(unavailable.status).toBe(422);
  expect(unavailable.body.code).toBe('STRATEGY_UNAVAILABLE');
  expect(unavailable.body.availableStrategies).toContain('NEARBY');
  await pool.query("UPDATE geo_data.place SET opening_hours='closed' WHERE id=$1", [ids[0]]);
  try {
    const empty = await owner
      .post(base() + '/ai-recommendations')
      .send({ strategy: 'NEARBY', keepPlaceIds: [ids[0]] });
    expect(empty.status).toBe(200);
    expect(empty.body.status).toBe('NO_CANDIDATES');
    expect(empty.body.plans).toEqual([]);
    expect(empty.body.preview).toBeNull();
    expect(empty.body.notice).not.toContain('변경됐어요');
  } finally {
    await pool.query('UPDATE geo_data.place SET opening_hours=NULL WHERE id=$1', [ids[0]]);
  }
});
