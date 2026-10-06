// Historical diagnostic assertions for ver2@3fa83a1, not desired-behavior CI tests.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? process.cwd());
const imp = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const { pool } = await imp('server/db.ts');
const { app } = await imp('server/app.ts');
const { default: request } = await imp('node_modules/supertest/index.js');
const { rankAlternatives } = await imp('server/weather-alternatives.ts');
const { sameRecommendationFacility } = await imp('server/recommendation-policy.ts');
const { routeSegment } = await imp('server/routing.ts');
const { computeSegment } = await imp('server/providers.ts');
const { summarizeRecommendationRoutes } = await imp('server/recommendation-preview.ts');
const { renderMetrics, resetMetricsForTest } = await imp('server/observability/metrics.ts');
const { name } = (await pool.query('SELECT current_database() AS name')).rows[0];
assert.match(name, /^bookhaedo_rereview_[a-f0-9]{32}$/); // Never run against the original catalog.
const findings: unknown[] = [];
const actualQuery = pool.query.bind(pool),
  actualConnect = pool.connect.bind(pool);
const ids = Array.from({ length: 5 }, () => randomUUID());
const date = '2026-10-10';
const savedValhalla = process.env.VALHALLA_BASE_URL;
const savedGoogle = process.env.GOOGLE_MAPS_SERVER_API_KEY;
try {
  for (const [i, id] of ids.entries())
    await actualQuery(
      `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km,osm_tags)
      VALUES($1,'furano','ATTRACTION',$2,$2,$3,142.39,ST_SetSRID(ST_MakePoint(142.39,$3),4326)::geography,0,$4::jsonb)`,
      [
        id,
        i === 1 ? 'Museum A' : i === 2 ? 'Ｍｕｓｅｕｍ Ａ' : `Review ${i}`,
        43.34 + (i === 2 ? 0.00101 : i * 0.001),
        JSON.stringify({ tourism: i === 0 ? 'zoo' : 'museum' }),
      ],
    );
  const registered = await request(app)
    .post('/api/auth/register')
    .send({
      email: randomUUID() + '@example.test',
      name: 'Review',
      password: 'review-password-42',
    });
  assert.equal(registered.status, 201);
  const cookie = registered.headers['set-cookie'][0].split(';')[0]; // Memory only; never print it.
  const http = (method: string, path: string, body?: unknown) =>
    request(app)[method](path).set('Cookie', cookie).send(body);
  const created = await http('post', '/api/trips', {
    title: 'Review',
    startDate: date,
    days: 1,
    transportMode: 'WALK',
  });
  assert.equal(created.status, 201);
  const trip = created.body.data.id,
    base = `/api/trips/${trip}/days/${date}`;
  assert.equal(
    (await http('put', base + '/items', { placeIds: ids.slice(0, 2), expectedRevision: 0 })).status,
    200,
  );
  const load = async () => (await http('get', '/api/trips/' + trip)).body.data;
  const before = await load();
  const payload = {
    placeIds: ids.slice(3, 5),
    expectedPlaceIds: ids.slice(0, 2),
    expectedRevision: before.days[0].revision,
    expectedTransportMode: 'WALK',
  };
  assert.equal(
    (
      await http('patch', base + '/day-alternatives', {
        ...payload,
        expectedTransportMode: 'BICYCLE',
      })
    ).status,
    409,
  );
  let changed = false;
  const interceptConnect = async () => {
    const db = await actualConnect(),
      query = db.query.bind(db);
    db.query = (async (...args: any[]) => {
      const result = await query(...args);
      if (
        !changed &&
        typeof args[0] === 'string' &&
        args[0].startsWith('SELECT d.id,d.revision,t.transport_mode')
      ) {
        changed = true;
        await actualQuery("UPDATE planner.trip SET transport_mode='BICYCLE' WHERE id=$1", [trip]);
      }
      return result;
    }) as any;
    const release = db.release.bind(db);
    db.release = ((...args: any[]) => {
      db.query = query;
      return release(...args);
    }) as any;
    return db;
  };
  pool.connect = ((callback?: unknown) =>
    typeof callback === 'function' ? actualConnect(callback) : interceptConnect()) as any;
  const confirmed = await http('patch', base + '/day-alternatives', payload);
  pool.connect = actualConnect;
  assert.equal(changed, true);
  assert.equal(confirmed.status, 200);
  const after = await load();
  assert.equal(after.transportMode, 'BICYCLE');
  assert.deepEqual(
    after.days[0].items.map((p: any) => p.id),
    payload.placeIds,
  );
  findings.push({
    id: 'F1',
    beforeMode: 'WALK',
    concurrentlyCommittedMode: 'BICYCLE',
    confirmationStatus: confirmed.status,
    savedRevision: after.days[0].revision,
    controlMismatchedModeStatus: 409,
  });

  let intervened = false;
  const newIds = [ids[0], ids[1]];
  pool.query = (async (...args: any[]) => {
    const result = await actualQuery(...args);
    if (
      !intervened &&
      typeof args[0] === 'string' &&
      args[0].startsWith('SELECT id,visit_date::text AS date,revision FROM planner.trip_day')
    ) {
      intervened = true;
      const db = await actualConnect();
      try {
        await db.query('BEGIN');
        await db.query('SELECT id FROM planner.trip_day WHERE id=$1 FOR UPDATE', [
          after.days[0].id,
        ]);
        await db.query('DELETE FROM planner.itinerary_item WHERE day_id=$1', [after.days[0].id]);
        for (const [i, id] of newIds.entries())
          await db.query(
            'INSERT INTO planner.itinerary_item(id,day_id,place_id,position)VALUES($1,$2,$3,$4)',
            [randomUUID(), after.days[0].id, id, i],
          );
        await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
          after.days[0].id,
        ]);
        await db.query('COMMIT');
      } finally {
        db.release();
      }
    }
    return result;
  }) as any;
  const mixed = await load();
  pool.query = actualQuery;
  const fresh = await load();
  assert.equal(intervened, true);
  assert.equal(mixed.days[0].revision, after.days[0].revision);
  assert.equal(fresh.days[0].revision, mixed.days[0].revision + 1);
  assert.deepEqual(
    mixed.days[0].items.map((p: any) => p.id),
    newIds,
  );
  findings.push({
    id: 'F2',
    responseRevision: mixed.days[0].revision,
    actualRevision: fresh.days[0].revision,
    responseContainsNextRevisionItems: true,
  });

  const item = fresh.days[0].items[1];
  const duplicate = {
    ...item,
    id: ids[2],
    name: 'Ｍｕｓｅｕｍ Ａ',
    nameJa: 'Ｍｕｓｅｕｍ Ａ',
    latitude: 43.34101,
  };
  const target = fresh.days[0].items[0];
  assert.equal(sameRecommendationFacility(item, duplicate), true);
  assert.equal(rankAlternatives([duplicate], fresh.days[0].items, target).length, 1);
  assert.equal(
    rankAlternatives([{ ...duplicate, nameJa: item.nameJa }], fresh.days[0].items, target).length,
    0,
  );
  const replaced = await http('patch', base + '/weather-alternatives', {
    placeIds: newIds,
    targetId: ids[0],
    replacementId: ids[2],
    expectedRevision: fresh.days[0].revision,
  });
  assert.equal(replaced.status, 200);
  const duplicateDay = (await load()).days[0];
  assert.equal(sameRecommendationFacility(...duplicateDay.items), true);
  findings.push({
    id: 'F3',
    rankedDuplicateCount: 1,
    exactNameDuplicateControlCount: 0,
    confirmationStatus: replaced.status,
    savedDuplicateFacility: true,
  });

  const encode = (points: number[][]) => {
    let lat = 0,
      lon = 0,
      encoded = '';
    const push = (n: number) => {
      let v = n < 0 ? ~(n << 1) : n << 1;
      while (v >= 32) {
        encoded += String.fromCharCode((32 | (v & 31)) + 63);
        v >>>= 5;
      }
      encoded += String.fromCharCode(v + 63);
    };
    for (const [y, x] of points) {
      const a = Math.round(y * 1e6),
        b = Math.round(x * 1e6);
      push(a - lat);
      push(b - lon);
      lat = a;
      lon = b;
    }
    return encoded;
  };
  process.env.VALHALLA_BASE_URL = 'http://127.0.0.1:9999';
  let calls = 0;
  const transport = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        trip: {
          status: 0,
          summary: { length: 0.1, time: 30 },
          legs: [
            {
              shape: encode([
                [95, 142],
                [95.001, 142.001],
              ]),
            },
          ],
        },
      }),
    );
  }) as typeof fetch;
  const a = { id: 'geometry-a', latitude: 43.34, longitude: 142.39 },
    b = { id: 'geometry-b', latitude: 43.341, longitude: 142.391 };
  const malformed = await routeSegment(a, b, 'WALK', transport);
  const cached = await routeSegment(a, b, 'WALK', transport);
  assert.equal(malformed.source, 'valhalla');
  assert.equal(calls, 1);
  assert.equal(cached.coordinates[0][1], 95);
  assert.equal(summarizeRecommendationRoutes([malformed], 'WALK', date).complete, true);
  process.env.GOOGLE_MAPS_SERVER_API_KEY = 'loopback-fixture-not-a-real-key';
  const google = await computeSegment(
    a,
    b,
    'TRANSIT',
    (async () =>
      new Response(
        JSON.stringify({
          routes: [
            {
              distanceMeters: 100,
              duration: '30s',
              polyline: { encodedPolyline: { invalid: true } },
            },
          ],
        }),
      )) as typeof fetch,
  );
  assert.equal(google.source, 'google');
  assert.equal(typeof google.polyline, 'object');
  findings.push({
    id: 'F4',
    valhallaSource: malformed.source,
    invalidLatitude: 95,
    cached: true,
    upstreamCalls: calls,
    complete: true,
    googlePolylineType: typeof google.polyline,
    scope: 'Injected transport; no live provider or browser crash claim',
  });
  const empty = await http('post', '/api/trips', {
    title: 'Metrics review',
    startDate: date,
    days: 1,
    transportMode: 'WALK',
  });
  assert.equal(empty.status, 201);
  resetMetricsForTest();
  const nested = await http(
    'get',
    `/api/trips/${empty.body.data.id}/days/${date}/day-alternatives`,
  );
  assert.equal(nested.status, 200);
  const metrics = renderMetrics();
  assert.ok(metrics.includes('method="GET",route="/",status="200"'));
  const observations = [
    {
      id: 'O1',
      nestedRecommendationMetricRoute: '/',
      responseStatus: 200,
      scope:
        'Actual HTTP finish metrics; static template collision, not unbounded label cardinality',
    },
  ];
  console.log(
    JSON.stringify(
      {
        observations,
        baseline: '3fa83a1cb386ca721ac2528b6401cf70592c8684',
        findings,
        scope:
          'Controlled real PostgreSQL/HTTP plus injected provider geometry; no production measurement or auth-flake root cause claim',
      },
      null,
      2,
    ),
  );
} finally {
  pool.query = actualQuery;
  pool.connect = actualConnect;
  if (savedValhalla === undefined) delete process.env.VALHALLA_BASE_URL;
  else process.env.VALHALLA_BASE_URL = savedValhalla;
  if (savedGoogle === undefined) delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
  else process.env.GOOGLE_MAPS_SERVER_API_KEY = savedGoogle;
  await pool.end();
}
