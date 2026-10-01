import { beforeAll, afterAll, expect, it } from 'vitest';
import { pool, migrate } from '../server/db';
import { publishTourismBatch } from '../server/tourism-knowledge';
import { searchTourism } from '../server/tourism-search';
import { tourismBatch, tourismRecord } from './tourism-fixtures';
let original: any, snapshot: string;
const query = () =>
  searchTourism({
    anchor: { latitude: 43.34, longitude: 142.39 },
    regionId: 'furano',
    date: '2026-10-01',
    radius: 20000,
    interests: '',
  });
beforeAll(async () => {
  await migrate();
  original = (await pool.query("SELECT * FROM tourism_knowledge.source WHERE id='furano-events'"))
    .rows[0];
  const event = (externalId: string, extra: any = {}) =>
    tourismRecord({
      externalId,
      kind: 'event',
      resourceUrl: 'https://www.harp.lg.jp/opendata/dataset/2208/resource/8258/events.csv',
      latitude: null,
      longitude: null,
      locationStatus: 'missing',
      dateStatus: 'recurring',
      startDate: null,
      endDate: null,
      ...extra,
    });
  const records = [
    event('000-unknown', { dateStatus: 'unknown' }),
    ...Array.from({ length: 25 }, (_, i) => event(`recurring-${String(i).padStart(2, '0')}`)),
    event('ended', { dateStatus: 'confirmed', startDate: '2026-09-01', endDate: '2026-09-02' }),
    event('dated-recurring', { startDate: '2026-09-01', endDate: '2026-09-02' }),
    event('invalid', { validUntil: '2026-09-01' }),
    event('withdrawn'),
  ];
  snapshot = (
    await publishTourismBatch(
      pool,
      tourismBatch(records, 'furano-events', new Date(Date.now() + 100).toISOString()),
    )
  ).snapshotId;
  await pool.query(
    "UPDATE tourism_knowledge.record SET withdrawn_at=now() WHERE snapshot_id=$1 AND external_id='withdrawn'",
    [snapshot],
  );
});
afterAll(async () => {
  if (original)
    await pool.query(
      'UPDATE tourism_knowledge.source SET active_snapshot_id=$2,enabled=$3,rights_status=$4 WHERE id=$1',
      ['furano-events', original.active_snapshot_id, original.enabled, original.rights_status],
    );
  else
    await pool.query(
      "UPDATE tourism_knowledge.source SET active_snapshot_id=NULL WHERE id='furano-events'",
    );
  if (snapshot) await pool.query('DELETE FROM tourism_knowledge.snapshot WHERE id=$1', [snapshot]);
  if (!original) await pool.query("DELETE FROM tourism_knowledge.source WHERE id='furano-events'");
  await pool.end();
});
it('caps reference reading at 20, excludes it from plan evidence, and excludes dated/expired/withdrawn rows', async () => {
  const r = await query();
  expect(r.referenceEvents).toHaveLength(20);
  expect(r.referenceEvents![0].externalId).toBe('000-unknown');
  expect(
    r.referenceEvents!.every(
      (e) =>
        ['unknown', 'recurring'].includes(e.dateStatus) &&
        e.startDate === null &&
        e.endDate === null &&
        e.kind === 'event',
    ),
  ).toBe(true);
  expect(
    r.referenceEvents!.some((e) =>
      ['ended', 'dated-recurring', 'invalid', 'withdrawn'].includes(e.externalId),
    ),
  ).toBe(false);
  expect(r.evidence.some((e) => e.sourceId === 'furano-events')).toBe(false);
});
it('honors region, source withdrawal, current snapshot and freshness for reference rows', async () => {
  expect(
    (
      await searchTourism({
        anchor: { latitude: 43.34, longitude: 142.39 },
        regionId: 'new-chitose',
        date: '2026-10-01',
        radius: 20000,
        interests: '',
      })
    ).referenceEvents!.some((e) => e.sourceId === 'furano-events'),
  ).toBe(false);
  for (const field of ['enabled', 'rights_status']) {
    await pool.query(`UPDATE tourism_knowledge.source SET ${field}=$1 WHERE id='furano-events'`, [
      field === 'enabled' ? false : 'withdrawn',
    ]);
    expect((await query()).referenceEvents).toEqual([]);
    await pool.query(`UPDATE tourism_knowledge.source SET ${field}=$1 WHERE id='furano-events'`, [
      field === 'enabled' ? true : 'approved',
    ]);
  }
  const fetched = (
    await pool.query('SELECT fetched_at FROM tourism_knowledge.snapshot WHERE id=$1', [snapshot])
  ).rows[0].fetched_at;
  await pool.query(
    "UPDATE tourism_knowledge.snapshot SET fetched_at=now()-interval '91 days' WHERE id=$1",
    [snapshot],
  );
  expect((await query()).referenceEvents).toEqual([]);
  await pool.query('UPDATE tourism_knowledge.snapshot SET fetched_at=$2 WHERE id=$1', [
    snapshot,
    fetched,
  ]);
  expect(
    (
      await searchTourism({
        anchor: { latitude: 43.34, longitude: 142.39 },
        regionId: 'furano',
        date: '2026-10-01',
        radius: 20000,
        interests: '',
        snapshotIds: [],
      })
    ).referenceEvents,
  ).toEqual([]);
});
