// Diagnostic snapshot of ver2@9e29e46; assertions reproduce existing defects, not desired behavior.
// Not part of CI. After a fix, a failing assertion here may mean the defect was repaired.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const imp = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const { pool } = await imp('server/db.ts');
const { publishTourismBatch } = await imp('server/tourism-knowledge.ts');
const { searchTourism } = await imp('server/tourism-search.ts');
const { withdrawTourismRecord } = await imp('server/tourism-withdrawal.ts');
const { createTourismGraph, formatTourismResult } = await imp('server/ai/tourism-graph.ts');
const { dayContext } = await imp('server/day-alternatives.ts');
const { tourismRecord, tourismBatch } = await imp('tests/tourism-fixtures.ts');
try {
  if (!new URL(pool.options.connectionString).pathname.startsWith('/bookhaedo_review_'))
    throw Error('Disposable review DB required');
  const ids = Array.from({ length: 4 }, () => randomUUID());
  for (const [i, id] of ids.entries())
    await pool.query(
      `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km,osm_tags) VALUES($1,'furano','ATTRACTION',$2,$2,$3,142.39,ST_SetSRID(ST_MakePoint(142.39,$3),4326)::geography,0,'{"tourism":"museum"}')`,
      [id, `review-facility-${i}`, 43.34 + i / 10000],
    );
  const externalId = 'deep-review-record';
  await publishTourismBatch(
    pool,
    tourismBatch([tourismRecord({ externalId, titleJa: 'review-facility-1', latitude: 43.3401 })]),
  );
  const query = {
    anchor: { latitude: 43.34, longitude: 142.39 },
    regionId: 'furano',
    date: new Date().toISOString().slice(0, 10),
    radius: 10000,
    interests: '',
  };
  const initial = await searchTourism(query);
  assert.equal(initial.evidence.length, 1);
  let withdrawn = false;
  const input = {
    requestId: 'review',
    userId: 'review',
    tripId: 'review',
    dayId: 'review',
    date: query.date,
    revision: 0,
    items: initial.candidates.filter((p: any) => p.id === ids[0]),
    regionId: 'furano',
    transportMode: 'WALK',
    count: 3,
    keepPlaceIds: [],
    interests: '',
    strategy: 'KNOWLEDGE',
  };
  const graph = createTourismGraph({
    search: searchTourism,
    weather: async () => ({ available: false }),
    route: async (a: any, b: any) => {
      if (!withdrawn) {
        withdrawn = true;
        await withdrawTourismRecord(pool, { sourceId: 'furano-places', externalId });
      }
      return { from: a.id, to: b.id, source: 'valhalla', distanceMeters: 100, durationSeconds: 60 };
    },
  });
  const result = formatTourismResult(input, await graph.invoke({ input }));
  const fresh = await searchTourism(query);
  assert(result.evidence.some((e: any) => e.externalId === externalId));
  assert.equal(fresh.evidence.length, 0);

  const user = randomUUID(),
    trip = randomUUID(),
    day = randomUUID();
  await pool.query(
    'INSERT INTO planner.app_user(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
    [user, `${user}@example.test`, 'review', 'not-login-hash'],
  );
  await pool.query('INSERT INTO planner.trip(id,user_id,title) VALUES($1,$2,$3)', [
    trip,
    user,
    'review',
  ]);
  await pool.query('INSERT INTO planner.trip_day(id,trip_id,visit_date) VALUES($1,$2,$3)', [
    day,
    trip,
    query.date,
  ]);
  await pool.query(
    'INSERT INTO planner.itinerary_item(id,day_id,place_id,position) VALUES($1,$2,$3,0)',
    [randomUUID(), day, ids[0]],
  );
  let changed = false;
  const db = {
    query: async (sql: string, args: any[]) => {
      const q = await pool.query(sql, args);
      if (!changed && sql.startsWith('SELECT id,revision')) {
        changed = true;
        const writer = await pool.connect();
        try {
          await writer.query('BEGIN');
          await writer.query('UPDATE planner.itinerary_item SET place_id=$1 WHERE day_id=$2', [
            ids[1],
            day,
          ]);
          await writer.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [day]);
          await writer.query('COMMIT');
        } finally {
          writer.release();
        }
      }
      return q;
    },
  };
  const torn = await dayContext(trip, query.date, false, db);
  const current = await dayContext(trip, query.date);
  assert.equal(torn.revision, 0);
  assert.equal(current.revision, 1);
  assert.equal(torn.items[0].id, ids[1]);
  console.log(
    JSON.stringify(
      {
        D2: {
          withdrawalCommitted: true,
          responseStatus: result.status,
          responseEvidenceCount: result.evidence.length,
          newSearchEvidenceCount: fresh.evidence.length,
        },
        D3: {
          readRevision: torn.revision,
          readItems: 'new',
          committedRevision: current.revision,
          scope: 'barrier inserted between actual SQL statements; real concurrent PG transaction',
        },
        scope: 'disposable PostgreSQL database; no original tourism source changed',
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
