import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { pool, migrate } from '../server/db';
import { readQuery } from '../server/read-query';
import { operationBudget } from '../server/operation-budget';
import { dayContext } from '../server/day-alternatives';
import { revalidateTourismEvidence, searchTourism } from '../server/tourism-search';
import { publishTourismBatch } from '../server/tourism-knowledge';
import { withdrawTourismRecord } from '../server/tourism-withdrawal';
import { createTourismGraph, formatTourismResult } from '../server/ai/tourism-graph';
import { tourismBatch, tourismRecord } from './tourism-fixtures';
const ids = Array.from({ length: 4 }, () => randomUUID());
const user = randomUUID(),
  trip = randomUUID(),
  day = randomUUID(),
  externalId = 'ops-' + randomUUID();
const date = new Date().toISOString().slice(0, 10);
const email = user + '@example.test';
let original: any, snapshot: string;
const query = {
  anchor: { latitude: 43.34, longitude: 142.39 },
  regionId: 'furano',
  date,
  radius: 10000,
  interests: '',
};
async function resetEvidence() {
  await pool.query(
    "UPDATE tourism_knowledge.source SET enabled=true,rights_status='approved',active_snapshot_id=$1 WHERE id='furano-places'",
    [snapshot],
  );
  await pool.query(
    "DELETE FROM tourism_knowledge.withdrawal WHERE source_id='furano-places' AND external_id=$1",
    [externalId],
  );
  await pool.query(
    'UPDATE tourism_knowledge.record SET withdrawn_at=NULL,valid_until=NULL WHERE snapshot_id=$1',
    [snapshot],
  );
  await pool.query('UPDATE tourism_knowledge.snapshot SET fetched_at=now() WHERE id=$1', [
    snapshot,
  ]);
}
beforeAll(async () => {
  await migrate();
  original = (await pool.query("SELECT * FROM tourism_knowledge.source WHERE id='furano-places'"))
    .rows[0];
  for (const [i, id] of ids.entries())
    await pool.query(
      `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km,osm_tags) VALUES($1,'furano','ATTRACTION',$2,$2,$3,142.39,ST_SetSRID(ST_MakePoint(142.39,$3),4326)::geography,0,'{"tourism":"museum"}')`,
      [id, 'ops-facility-' + id, 43.34 + i / 10000],
    );
  snapshot = (
    await publishTourismBatch(
      pool,
      tourismBatch([
        tourismRecord({ externalId, titleJa: 'ops-facility-' + ids[1], latitude: 43.3401 }),
      ]),
    )
  ).snapshotId;
  await pool.query(
    'INSERT INTO planner.app_user(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
    [user, email, 'ops', 'not-login-hash'],
  );
  await pool.query(
    'INSERT INTO planner.trip(id,user_id,title,transport_mode) VALUES($1,$2,$3,$4)',
    [trip, user, 'ops', 'WALK'],
  );
  await pool.query('INSERT INTO planner.trip_day(id,trip_id,visit_date) VALUES($1,$2,$3)', [
    day,
    trip,
    date,
  ]);
  await pool.query(
    'INSERT INTO planner.itinerary_item(id,day_id,place_id,position,note) VALUES($1,$2,$3,0,$4)',
    [randomUUID(), day, ids[0], 'old note'],
  );
});
afterAll(async () => {
  await pool.query('DELETE FROM planner.app_user WHERE id=$1', [user]);
  await pool.query(
    "DELETE FROM tourism_knowledge.withdrawal WHERE source_id='furano-places' AND external_id=$1",
    [externalId],
  );
  if (original)
    await pool.query(
      'UPDATE tourism_knowledge.source SET active_snapshot_id=$2,enabled=$3,rights_status=$4,publisher=$5 WHERE id=$1',
      [
        'furano-places',
        original.active_snapshot_id,
        original.enabled,
        original.rights_status,
        original.publisher,
      ],
    );
  else
    await pool.query(
      "UPDATE tourism_knowledge.source SET active_snapshot_id=NULL WHERE id='furano-places'",
    );
  if (snapshot) await pool.query('DELETE FROM tourism_knowledge.snapshot WHERE id=$1', [snapshot]);
  if (!original) await pool.query("DELETE FROM tourism_knowledge.source WHERE id='furano-places'");
  await pool.query('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [ids]);
  await pool.end();
});
it('actually cancels SQL and discards the canceled connection before another borrower uses it', async () => {
  const db = new pg.Pool({ ...pool.options, max: 1 });
  const controller = new AbortController();
  const tag = 'cancel-' + randomUUID();
  try {
    const running = readQuery(`SELECT pg_sleep(8) /* ${tag} */`, [], controller.signal, db);
    const rejected = expect(running).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    let pid: number | undefined;
    for (let i = 0; i < 100 && !pid; i++) {
      pid = (
        await pool.query(
          "SELECT pid FROM pg_stat_activity WHERE query LIKE $1 AND state='active'",
          ['SELECT pg_sleep(8) /* ' + tag + ' */'],
        )
      ).rows[0]?.pid;
      if (!pid) await new Promise((r) => setTimeout(r, 5));
    }
    expect(pid).toBeTruthy();
    const start = performance.now();
    controller.abort();
    await rejected;
    expect(performance.now() - start).toBeLessThan(1500);
    expect(db.totalCount).toBe(0);
    const next = await db.query('SELECT pg_backend_pid() AS pid,42 AS answer');
    expect(next.rows[0].pid).not.toBe(pid);
    expect(next.rows[0].answer).toBe(42);
    expect(
      (await pool.query('SELECT state FROM pg_stat_activity WHERE pid=$1', [pid])).rowCount,
    ).toBe(0);
  } finally {
    await db.end();
  }
});
it('releases an acquisition that completes after cancellation, without running its SQL', async () => {
  const db = new pg.Pool({ ...pool.options, max: 1 });
  const held = await db.connect();
  const budget = operationBudget(30);
  try {
    await expect(readQuery('SELECT pg_sleep(5)', [], budget.signal, db)).rejects.toMatchObject({
      code: 'REQUEST_DEADLINE_EXCEEDED',
    });
    held.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(db.waitingCount).toBe(0);
    expect(db.idleCount).toBe(1);
    expect((await db.query('SELECT 7 AS n')).rows[0].n).toBe(7);
  } finally {
    budget.dispose();
    await db.end();
  }
});
it('enforces read-only SQL and preserves valid zero-row results', async () => {
  const budget = operationBudget();
  try {
    await expect(
      readQuery(
        'UPDATE planner.trip SET title=$1 WHERE id=$2',
        ['must not write', trip],
        budget.signal,
      ),
    ).rejects.toMatchObject({ code: '25006' });
    expect(
      (await pool.query('SELECT title FROM planner.trip WHERE id=$1', [trip])).rows[0].title,
    ).toBe('ops');
    expect(
      (await readQuery('SELECT id FROM planner.trip WHERE false', [], budget.signal)).rows,
    ).toEqual([]);
  } finally {
    budget.dispose();
  }
});
it('returns the revision, items and transport from one SQL snapshot across a concurrent committed update', async () => {
  const calls: string[] = [];
  const wrapper = {
    query: async (sql: string, args: any[]) => {
      calls.push(sql);
      const result = await pool.query(sql, args);
      const writer = await pool.connect();
      try {
        await writer.query('BEGIN');
        await writer.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [day]);
        await writer.query(
          "UPDATE planner.itinerary_item SET place_id=$1,note='new note' WHERE day_id=$2",
          [ids[1], day],
        );
        await writer.query("UPDATE planner.trip SET transport_mode='TRANSIT' WHERE id=$1", [trip]);
        await writer.query('COMMIT');
      } finally {
        writer.release();
      }
      return result;
    },
  };
  const read = await dayContext(trip, date, false, wrapper);
  const current = await dayContext(trip, date);
  expect(calls).toHaveLength(1);
  expect(read).toMatchObject({
    revision: 0,
    transportMode: 'WALK',
    items: [{ id: ids[0], note: 'old note' }],
  });
  expect(current).toMatchObject({
    revision: 1,
    transportMode: 'TRANSIT',
    items: [{ id: ids[1], note: 'new note' }],
  });
});
it('revalidates current metadata without transferring evidence to another place', async () => {
  const initial = await searchTourism(query);
  await pool.query(
    "UPDATE tourism_knowledge.source SET publisher='current metadata' WHERE id='furano-places'",
  );
  const checked = await revalidateTourismEvidence(initial.evidence, date);
  expect(checked).toHaveLength(1);
  expect(checked[0].publisher).toBe('current metadata');
  expect(checked[0].placeId).toBe(ids[1]);
});
for (const [label, sql, args] of [
  ['disabled', "UPDATE tourism_knowledge.source SET enabled=false WHERE id='furano-places'", []],
  [
    'withdrawn source',
    "UPDATE tourism_knowledge.source SET rights_status='withdrawn' WHERE id='furano-places'",
    [],
  ],
  [
    'replaced active snapshot',
    "UPDATE tourism_knowledge.source SET active_snapshot_id=NULL WHERE id='furano-places'",
    [],
  ],
  [
    'stale snapshot',
    "UPDATE tourism_knowledge.snapshot SET fetched_at=now()-interval '91 days' WHERE id=$1",
    () => [snapshot],
  ],
  [
    'expired record',
    'UPDATE tourism_knowledge.record SET valid_until=$2::date-1 WHERE snapshot_id=$1',
    () => [snapshot, date],
  ],
] as const)
  it('rejects evidence after ' + label, async () => {
    await resetEvidence();
    const initial = await searchTourism(query);
    try {
      await pool.query(sql, typeof args === 'function' ? args() : [...args]);
      expect(await revalidateTourismEvidence(initial.evidence, date)).toEqual([]);
    } finally {
      await resetEvidence();
    }
  });
it('removes actual withdrawal committed during route lookup from KNOWLEDGE, preview and response', async () => {
  await resetEvidence();
  const initial = await searchTourism(query);
  let withdrawn = false;
  const input = {
    requestId: 'ops',
    userId: user,
    tripId: trip,
    dayId: day,
    date,
    revision: 1,
    items: initial.candidates.filter((p) => p.id === ids[0]),
    regionId: 'furano',
    transportMode: 'WALK',
    count: 3,
    keepPlaceIds: [],
    interests: '',
    strategy: 'KNOWLEDGE',
  };
  const graph = createTourismGraph({
    search: searchTourism,
    revalidate: revalidateTourismEvidence,
    weather: async () => ({ available: false }) as any,
    route: async (a: any, b: any) => {
      if (!withdrawn) {
        withdrawn = true;
        await withdrawTourismRecord(pool, { sourceId: 'furano-places', externalId });
      }
      return {
        from: a.id,
        to: b.id,
        source: 'valhalla',
        distanceMeters: 100,
        durationSeconds: 60,
      } as any;
    },
  });
  try {
    const result = formatTourismResult(input, await graph.invoke({ input }));
    expect(withdrawn).toBe(true);
    expect(result.evidence).toEqual([]);
    expect(result.plans.some((p) => p.id === 'KNOWLEDGE')).toBe(false);
    expect(result.preview).toBeNull();
    expect(result.status).toBe('CATALOG_FALLBACK');
    expect((await searchTourism(query)).evidence).toEqual([]);
  } finally {
    await resetEvidence();
  }
});

it('reads committed items after waiting for a writer lock during confirmation', async () => {
  const writer = await pool.connect();
  const reader = new pg.Client({ ...pool.options, application_name: 'ops-reader-' + day });
  await reader.connect();
  try {
    await writer.query('BEGIN');
    await writer.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [day]);
    await writer.query(
      "UPDATE planner.itinerary_item SET place_id=$1,note='after lock' WHERE day_id=$2",
      [ids[2], day],
    );
    await reader.query('BEGIN');
    const reading = dayContext(trip, date, true, reader);
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      waiting =
        (
          await pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
            ['ops-reader-' + day],
          )
        ).rowCount === 1;
      if (!waiting) await new Promise((r) => setTimeout(r, 5));
    }
    expect(waiting).toBe(true);
    await writer.query('COMMIT');
    const state = await reading;
    expect(state.items).toMatchObject([{ id: ids[2], note: 'after lock' }]);
    expect(state.revision).toBe(2);
    await reader.query('ROLLBACK');
  } finally {
    await writer.query('ROLLBACK');
    writer.release();
    await reader.end();
  }
});

it('falls back to the SQL statement bound if the cancellation transport fails, and still discards the target', async () => {
  const db = new pg.Pool({ ...pool.options, max: 1 });
  const controller = new AbortController();
  const tag = 'cancel-fallback-' + randomUUID();
  const original = pg.Client.prototype.query;
  const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
    this: pg.Client,
    sql: any,
    ...args: any[]
  ) {
    return sql === 'SELECT pg_cancel_backend($1)'
      ? Promise.reject(Error('transport failed'))
      : (original as any).call(this, sql, ...args);
  } as any);
  try {
    const running = readQuery(`SELECT pg_sleep(8) /* ${tag} */`, [], controller.signal, db);
    const rejected = expect(running).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    let active = false;
    for (let i = 0; i < 100 && !active; i++) {
      active =
        (
          await pool.query("SELECT 1 FROM pg_stat_activity WHERE query=$1 AND state='active'", [
            `SELECT pg_sleep(8) /* ${tag} */`,
          ])
        ).rowCount === 1;
      if (!active) await new Promise((r) => setTimeout(r, 5));
    }
    expect(active).toBe(true);
    controller.abort();
    const start = performance.now();
    await rejected;
    expect(performance.now() - start).toBeLessThan(4500);
    expect(db.totalCount).toBe(0);
    expect((await db.query('SELECT 7 AS n')).rows[0].n).toBe(7);
  } finally {
    spy.mockRestore();
    await db.end();
  }
});
