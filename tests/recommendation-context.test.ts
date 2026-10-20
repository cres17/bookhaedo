import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
const control = vi.hoisted(() => ({ change: '', captured: null as any, badWeather: false }));
vi.mock('../server/ai/tourism-graph', async (original) => ({
  ...(await original<any>()),
  proposeTourism: vi.fn(async (input: any, signal: AbortSignal) => {
    control.captured = { input, signal };
    const { pool } = await import('../server/db');
    if (control.change === 'revision')
      await pool.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        input.dayId,
      ]);
    if (control.change === 'mode')
      await pool.query("UPDATE planner.trip SET transport_mode='BICYCLE' WHERE id=$1", [
        input.tripId,
      ]);
    return { status: 'CATALOG_FALLBACK', plans: [], preview: null };
  }),
}));
vi.mock('../server/providers', async (original) => ({
  ...(await original<any>()),
  forecast: vi.fn(async () =>
    control.badWeather
      ? { available: true, description: '비', precipitationMm: 10 }
      : { available: false },
  ),
}));
vi.mock('../server/routing', async (original) => ({
  ...(await original<any>()),
  routeSegment: vi.fn(async (a: any, b: any) => ({
    from: a.id,
    to: b.id,
    source: 'valhalla',
    distanceMeters: 1000,
    durationSeconds: 1800,
  })),
}));
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
const owner = request.agent(app);
const ids = Array.from({ length: 5 }, () => randomUUID());
const email = randomUUID() + '@example.test';
let trip = '',
  base = '';
beforeAll(async () => {
  await migrate();
  for (const [i, id] of ids.entries())
    await pool.query(
      `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km,osm_tags) VALUES($1,'furano','ATTRACTION',$2,$2,$3,142.39,ST_SetSRID(ST_MakePoint(142.39,$3),4326)::geography,0,$4::jsonb)`,
      [
        id,
        'context-' + id,
        43.34 + i * 0.001,
        JSON.stringify({ tourism: i === 0 ? 'zoo' : 'museum' }),
      ],
    );
  expect(
    (
      await owner
        .post('/api/auth/register')
        .send({ email, name: 'context', password: 'context-password' })
    ).status,
  ).toBe(201);
  const created = await owner
    .post('/api/trips')
    .send({ title: 'context', startDate: '2026-10-10', days: 1, transportMode: 'TRANSIT' });
  expect(created.status, created.body.error).toBe(201);
  trip = created.body.data.id;
  base = `/api/trips/${trip}/days/2026-10-10`;
  expect(
    (await owner.put(base + '/items').send({ placeIds: ids.slice(0, 2), expectedRevision: 0 }))
      .status,
  ).toBe(200);
});
afterAll(async () => {
  await pool.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
  await pool.query('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [ids]);
  await pool.end();
});
it('passes a cancellable request and the coherent transport mode to the graph', async () => {
  control.change = '';
  const response = await owner.post(base + '/ai-recommendations').send({});
  expect(response.status, response.body.error).toBe(200);
  expect(control.captured.input.transportMode).toBe('TRANSIT');
  expect(control.captured.input.revision).toBe(1);
  expect(control.captured.signal).toBeInstanceOf(AbortSignal);
});
for (const field of ['revision', 'mode'])
  it('rejects a recommendation if ' + field + ' changes during graph execution', async () => {
    control.change = field;
    try {
      const response = await owner.post(base + '/ai-recommendations').send({});
      expect(response.status, response.body.error).toBe(409);
      expect(response.body.code).toBe('RECOMMENDATION_CONTEXT_CHANGED');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.preview).toBeUndefined();
    } finally {
      control.change = '';
    }
  });
async function payload() {
  const t = (await owner.get('/api/trips/' + trip)).body.data;
  const day = t.days[0];
  return {
    placeIds: ids.slice(2, 4),
    expectedPlaceIds: day.items.map((p: any) => p.id),
    expectedRevision: day.revision,
    expectedTransportMode: t.transportMode,
  };
}
it('rejects a newly closed place at confirmation and leaves the existing itinerary intact', async () => {
  const data = await payload();
  await pool.query("UPDATE geo_data.place SET opening_hours='closed' WHERE id=$1", [ids[2]]);
  try {
    const response = await owner.patch(base + '/day-alternatives').send(data);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PLACE_INELIGIBLE');
    const day = (await owner.get('/api/trips/' + trip)).body.data.days[0];
    expect(day.revision).toBe(data.expectedRevision);
    expect(day.items.map((p: any) => p.id)).toEqual(data.expectedPlaceIds);
  } finally {
    await pool.query('UPDATE geo_data.place SET opening_hours=NULL WHERE id=$1', [ids[2]]);
  }
});
it('rejects a different-ID duplicate facility at confirmation without transferring its data', async () => {
  const data = await payload();
  await pool.query(
    'UPDATE geo_data.place SET name_ja=$2,latitude=$3,location=ST_SetSRID(ST_MakePoint(142.39,$3),4326)::geography WHERE id=$1',
    [ids[3], 'context-' + ids[2], 43.342],
  );
  try {
    const response = await owner.patch(base + '/day-alternatives').send(data);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PLACE_INELIGIBLE');
    expect((await owner.get('/api/trips/' + trip)).body.data.days[0].revision).toBe(
      data.expectedRevision,
    );
  } finally {
    await pool.query(
      'UPDATE geo_data.place SET name_ja=$2,latitude=$3,location=ST_SetSRID(ST_MakePoint(142.39,$3),4326)::geography WHERE id=$1',
      [ids[3], 'context-' + ids[3], 43.343],
    );
  }
});
it('rejects confirmation when the preview transport no longer matches', async () => {
  const data = await payload();
  const response = await owner
    .patch(base + '/day-alternatives')
    .send({ ...data, expectedTransportMode: 'WALK' });
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('RECOMMENDATION_CONTEXT_CHANGED');
});
it('legacy day preview routes TRANSIT segments but does not sum their independent times', async () => {
  expect(
    (await owner.patch('/api/trips/' + trip).send({ title: 'context', transportMode: 'TRANSIT' }))
      .status,
  ).toBe(200);
  const response = await owner.get(base + '/day-alternatives?count=3&strategy=NEARBY');
  expect(response.status, response.body.error).toBe(200);
  expect(response.body.preview).toMatchObject({
    mode: 'TRANSIT',
    complete: true,
    timelineStatus: 'NOT_EVALUATED',
    durationSeconds: null,
  });
  expect(response.body.preview.segments.every((s: any) => s.durationSeconds === 1800)).toBe(true);
});
it('weather replacement preview does not fabricate a TRANSIT aggregate time difference', async () => {
  control.badWeather = true;
  try {
    const candidates = await owner.get(base + '/weather-alternatives?targetId=' + ids[0]);
    expect(candidates.status, candidates.body.error).toBe(200);
    expect(candidates.body.data.length).toBeGreaterThan(0);
    const response = await owner.get(
      base +
        '/weather-alternatives?targetId=' +
        ids[0] +
        '&previewId=' +
        candidates.body.data[0].id,
    );
    expect(response.status, response.body.error).toBe(200);
    expect(response.body.preview.before.durationSeconds).toBeNull();
    expect(response.body.preview.after.durationSeconds).toBeNull();
    expect(response.body.preview.durationDeltaSeconds).toBeNull();
    expect(response.body.preview.after.timelineStatus).toBe('NOT_EVALUATED');
  } finally {
    control.badWeather = false;
  }
});
