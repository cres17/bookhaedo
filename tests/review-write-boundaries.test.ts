import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
import { rankAlternatives } from '../server/weather-alternatives';
import { renderMetrics, resetMetricsForTest } from '../server/observability/metrics';
const owner = request.agent(app);
const email = randomUUID() + '@example.test';
const memberEmail = randomUUID() + '@example.test';
const member = request.agent(app);
let memberId = '';
const ids = Array.from({ length: 5 }, () => randomUUID());
let trip = '',
  base = '';
const actualConnect = pool.connect.bind(pool);
const actualQuery = pool.query.bind(pool);
const wait = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
beforeAll(async () => {
  await migrate();
  for (const [i, id] of ids.entries())
    await pool.query(
      `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km,osm_tags) VALUES($1,'furano','ATTRACTION',$2,$2,$3,142.39,ST_SetSRID(ST_MakePoint(142.39,$3),4326)::geography,0,$4::jsonb)`,
      [
        id,
        i === 1 ? 'Museum A' : i === 2 ? 'Ｍｕｓｅｕｍ Ａ' : 'Boundary ' + id,
        43.34 + (i === 2 ? 0.00101 : i * 0.001),
        JSON.stringify({ tourism: i === 0 ? 'zoo' : 'museum' }),
      ],
    );
  expect(
    (
      await owner
        .post('/api/auth/register')
        .send({ email, name: 'boundary', password: 'boundary-password' })
    ).status,
  ).toBe(201);
  expect(
    (
      await member
        .post('/api/auth/register')
        .send({ email: memberEmail, name: 'member', password: 'member-password' })
    ).status,
  ).toBe(201);
  memberId = (await actualQuery('SELECT id FROM planner.app_user WHERE email=$1', [memberEmail]))
    .rows[0].id;
});
afterEach(() => {
  pool.connect = actualConnect;
  pool.query = actualQuery;
  vi.restoreAllMocks();
  resetMetricsForTest();
});
afterAll(async () => {
  await actualQuery('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [
    [email, memberEmail],
  ]);
  await actualQuery('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [ids]);
  await pool.end();
});
async function setup() {
  const created = await owner
    .post('/api/trips')
    .send({ title: 'boundary', startDate: '2026-10-10', days: 1, transportMode: 'WALK' });
  expect(created.status, created.body.error).toBe(201);
  trip = created.body.data.id;
  base = `/api/trips/${trip}/days/2026-10-10`;
  expect(
    (await owner.put(base + '/items').send({ placeIds: ids.slice(0, 2), expectedRevision: 0 }))
      .status,
  ).toBe(200);
  return (await owner.get('/api/trips/' + trip)).body.data;
}
function interceptClient(hook: (sql: string, run: () => Promise<any>) => Promise<any>) {
  pool.connect = ((cb?: unknown) =>
    typeof cb === 'function'
      ? actualConnect(cb as never)
      : (async () => {
          const db = await actualConnect();
          const query = db.query.bind(db);
          db.query = ((...args: any[]) =>
            typeof args[0] === 'string'
              ? hook(args[0], () => query(...(args as [any])))
              : query(...(args as [any]))) as any;
          const release = db.release.bind(db);
          db.release = ((...args: any[]) => {
            db.query = query;
            release(...(args as [any]));
          }) as any;
          return db;
        })()) as any;
}
it('returns revision, items and metadata from one snapshot despite intervening commits', async () => {
  const before = await setup();
  let changed = false;
  const change = async () => {
    const db = await actualConnect();
    try {
      await db.query('BEGIN');
      await db.query('DELETE FROM planner.itinerary_item WHERE day_id=$1', [before.days[0].id]);
      await db.query(
        'INSERT INTO planner.itinerary_item(id,day_id,place_id,position) VALUES($1,$2,$3,0)',
        [randomUUID(), before.days[0].id, ids[3]],
      );
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        before.days[0].id,
      ]);
      await db.query(
        "UPDATE planner.trip SET title='new-title',transport_mode='BICYCLE' WHERE id=$1",
        [trip],
      );
      await db.query('COMMIT');
    } finally {
      db.release();
    }
  };
  pool.query = (async (...args: any[]) => {
    const result = await actualQuery(...(args as [any]));
    if (
      !changed &&
      typeof args[0] === 'string' &&
      (args[0].startsWith('SELECT id,visit_date::text AS date,revision') ||
        args[0].includes('AS "days"'))
    ) {
      changed = true;
      await change();
    }
    return result;
  }) as any;
  interceptClient(async (sql, run) => {
    const result = await run();
    if (!changed && sql.includes('AS "days"')) {
      changed = true;
      await change();
    }
    return result;
  });
  const response = await owner.get('/api/trips/' + trip);
  expect(response.status).toBe(200);
  expect(changed).toBe(true);
  const day = response.body.data.days[0];
  expect(day.revision).toBe(before.days[0].revision);
  expect(day.items.map((p: any) => p.id)).toEqual(ids.slice(0, 2));
  expect(response.body.data.transportMode).toBe('WALK');
  expect(response.body.data.title).toBe('boundary');
  const fresh = (await owner.get('/api/trips/' + trip)).body.data;
  expect(fresh.days[0].revision).toBe(day.revision + 1);
  expect(fresh.days[0].items[0].id).toBe(ids[3]);
  expect(fresh.transportMode).toBe('BICYCLE');
});
it('serializes a mode update committed before confirmation and rejects the stale mode', async () => {
  const before = await setup();
  const blocker = await actualConnect();
  const phase = wait();
  let seen = false;
  try {
    await blocker.query('BEGIN');
    await blocker.query('UPDATE planner.trip SET transport_mode=$1 WHERE id=$2', ['BICYCLE', trip]);
    interceptClient(async (sql, run) => {
      if (!seen && sql.startsWith('SELECT id FROM planner.trip WHERE')) {
        seen = true;
        phase.resolve();
        return run();
      }
      const result = await run();
      if (!seen && sql.startsWith('SELECT d.id,d.revision,t.transport_mode')) {
        seen = true;
        phase.resolve();
      }
      return result;
    });
    const confirmation = owner
      .patch(base + '/day-alternatives')
      .send({
        placeIds: ids.slice(3, 5),
        expectedPlaceIds: ids.slice(0, 2),
        expectedRevision: before.days[0].revision,
        expectedTransportMode: 'WALK',
      })
      .then((r) => r);
    await phase.promise;
    await blocker.query('COMMIT');
    const result = await confirmation;
    expect(result.status, result.body.error).toBe(409);
    expect(result.body.code).toBe('RECOMMENDATION_CONTEXT_CHANGED');
    const day = (await owner.get('/api/trips/' + trip)).body.data.days[0];
    expect(day.revision).toBe(before.days[0].revision);
    expect(day.items.map((p: any) => p.id)).toEqual(ids.slice(0, 2));
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
});
it('excludes normalized duplicate facilities from weather ranking but permits a distinct branch', () => {
  const target = {
    id: ids[0],
    regionId: 'furano',
    category: 'ATTRACTION',
    nameJa: 'Zoo',
    latitude: 43.34,
    longitude: 142.39,
    tags: { tourism: 'zoo' },
  };
  const kept = {
    id: ids[1],
    regionId: 'furano',
    category: 'ATTRACTION',
    nameJa: 'Museum A',
    latitude: 43.341,
    longitude: 142.39,
    tags: { tourism: 'museum' },
  };
  const duplicate = { ...kept, id: ids[2], nameJa: 'Ｍｕｓｅｕｍ Ａ', latitude: 43.34101 };
  expect(rankAlternatives([duplicate], [target, kept], target)).toEqual([]);
  expect(
    rankAlternatives([{ ...duplicate, latitude: 43.35 }], [target, kept], target),
  ).toHaveLength(1);
});
it('rejects a duplicate weather replacement and leaves every saved item field unchanged', async () => {
  const before = await setup();
  const r = await owner.patch(base + '/weather-alternatives').send({
    placeIds: ids.slice(0, 2),
    targetId: ids[0],
    replacementId: ids[2],
    expectedRevision: before.days[0].revision,
  });
  expect(r.status, r.body.error).toBe(400);
  expect(r.body.code).toBe('PLACE_INELIGIBLE');
  expect((await owner.get('/api/trips/' + trip)).body.data.days).toEqual(before.days);
  const good = await owner.patch(base + '/weather-alternatives').send({
    placeIds: ids.slice(0, 2),
    targetId: ids[0],
    replacementId: ids[3],
    expectedRevision: before.days[0].revision,
  });
  expect(good.status, good.body.error).toBe(200);
});
it('reports a bounded complete operation label for nested recommendation endpoints', async () => {
  await setup();
  resetMetricsForTest();
  const r = await owner.get(base + '/day-alternatives?count=3');
  expect(r.status, r.body.error).toBe(200);
  const metrics = renderMetrics();
  expect(metrics).toContain('route="/api/trips/:id/days/:date/day-alternatives"');
  expect(metrics).not.toContain(trip);
});

it('allows confirmation first and serializes a later mode change after it', async () => {
  const before = await setup();
  const paused = wait(),
    resume = wait(),
    modeAttempt = wait();
  let waiting = false,
    modeSettled = false;
  interceptClient(async (sql, run) => {
    if (waiting && sql.startsWith('SELECT id FROM planner.trip WHERE')) modeAttempt.resolve();
    const result = await run();
    if (!waiting && sql.startsWith('SELECT d.id,d.revision,t.transport_mode')) {
      waiting = true;
      paused.resolve();
      await resume.promise;
    }
    return result;
  });
  const confirm = owner
    .patch(base + '/day-alternatives')
    .send({
      placeIds: ids.slice(3, 5),
      expectedPlaceIds: ids.slice(0, 2),
      expectedRevision: before.days[0].revision,
      expectedTransportMode: 'WALK',
    })
    .then((r) => r);
  try {
    await paused.promise;
    const mode = owner
      .patch('/api/trips/' + trip)
      .send({ title: 'later', transportMode: 'BICYCLE' })
      .then((r) => {
        modeSettled = true;
        return r;
      });
    await modeAttempt.promise;
    expect(modeSettled).toBe(false);
    resume.resolve();
    expect((await confirm).status).toBe(200);
    expect((await mode).status).toBe(200);
    const current = (await owner.get('/api/trips/' + trip)).body.data;
    expect(current.transportMode).toBe('BICYCLE');
    expect(current.days[0].revision).toBe(before.days[0].revision + 1);
    expect(current.days[0].items.map((p: any) => p.id)).toEqual(ids.slice(3, 5));
  } finally {
    resume.resolve();
    await confirm;
  }
});
it('retains item identity, note, cost and schedule through reorder and recommendation confirmation', async () => {
  const before = await setup();
  const dayId = before.days[0].id;
  await actualQuery(
    "UPDATE planner.itinerary_item SET note='retained-note',estimated_cost=123,start_minute=540,end_minute=600 WHERE day_id=$1 AND place_id=$2",
    [dayId, ids[1]],
  );
  const original = (await owner.get('/api/trips/' + trip)).body.data.days[0];
  const put = await owner
    .put(base + '/items')
    .send({ placeIds: [ids[1], ids[0], ids[3]], expectedRevision: original.revision });
  expect(put.status, put.body.error).toBe(200);
  const reordered = (await owner.get('/api/trips/' + trip)).body.data.days[0];
  expect(reordered.items.find((p: any) => p.id === ids[1])).toEqual({
    ...original.items[1],
    position: 0,
  });
  const confirmed = await owner.patch(base + '/day-alternatives').send({
    placeIds: [ids[4], ids[1]],
    expectedPlaceIds: reordered.items.map((p: any) => p.id),
    expectedRevision: reordered.revision,
    expectedTransportMode: 'WALK',
  });
  expect(confirmed.status, confirmed.body.error).toBe(200);
  const saved = (await owner.get('/api/trips/' + trip)).body.data.days[0];
  expect(saved.items[1]).toEqual({ ...original.items[1], position: 1 });
  expect(saved.items[0]).toMatchObject({
    id: ids[4],
    note: '',
    estimatedCost: null,
    startMinute: null,
    endMinute: null,
  });
});
it('serializes day creation and deletion with itinerary writers without deadlocks', async () => {
  await setup();
  const results = await Promise.all([
    owner.post('/api/trips/' + trip + '/days').send({ date: '2026-10-11' }),
    owner
      .patch(base + '/items/' + ids[1] + '/note')
      .send({ note: 'parallel', expectedRevision: 1 }),
    owner.delete('/api/trips/' + trip),
  ]);
  expect(results[0].status).toSatisfy((status: number) => [201, 404].includes(status));
  expect(results[1].status).toSatisfy((status: number) => [200, 404].includes(status));
  expect(results[2].status).toBe(204);
  expect((await owner.get('/api/trips/' + trip)).status).toBe(404);
});

it('rechecks accepted membership after waiting for the parent trip lock', async () => {
  const before = await setup();
  await actualQuery('INSERT INTO planner.trip_member(trip_id,user_id) VALUES($1,$2)', [
    trip,
    memberId,
  ]);
  const blocker = await actualConnect();
  const attempted = wait();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM planner.trip WHERE id=$1 FOR UPDATE', [trip]);
    interceptClient(async (sql, run) => {
      if (sql.startsWith('SELECT id FROM planner.trip WHERE')) attempted.resolve();
      return run();
    });
    const confirmation = member
      .patch(base + '/day-alternatives')
      .send({
        placeIds: ids.slice(3, 5),
        expectedPlaceIds: ids.slice(0, 2),
        expectedRevision: before.days[0].revision,
        expectedTransportMode: 'WALK',
      })
      .then((r) => r);
    await attempted.promise;
    await blocker.query('DELETE FROM planner.trip_member WHERE trip_id=$1 AND user_id=$2', [
      trip,
      memberId,
    ]);
    await blocker.query('COMMIT');
    expect((await confirmation).status).toBe(404);
    expect((await owner.get('/api/trips/' + trip)).body.data.days).toEqual(before.days);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
});
it('returns a bounded lock conflict with no itinerary mutation', async () => {
  const before = await setup();
  const blocker = await actualConnect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM planner.trip WHERE id=$1 FOR UPDATE', [trip]);
    const response = await owner.patch(base + '/day-alternatives').send({
      placeIds: ids.slice(3, 5),
      expectedPlaceIds: ids.slice(0, 2),
      expectedRevision: before.days[0].revision,
      expectedTransportMode: 'WALK',
    });
    expect(response.status, response.body.error).toBe(409);
    expect(response.body.code).toBe('TRIP_WRITE_BUSY');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.requestId).toEqual(expect.any(String));
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  expect((await owner.get('/api/trips/' + trip)).body.data.days).toEqual(before.days);
});
