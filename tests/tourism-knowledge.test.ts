import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, migrate } from '../server/db';
import { publishTourismBatch } from '../server/tourism-knowledge';
import { searchTourism } from '../server/tourism-search';
import { tourismBatch, tourismRecord } from './tourism-fixtures';
const sourceIds = ['furano-places', 'eniwa-events'];
const snapshots: string[] = [];
let original: any[] = [];
let place: any;
let time = Date.now();
const batch = (records: unknown[], source = 'furano-places') =>
  tourismBatch(records, source, new Date(++time).toISOString());
const publish = async (raw: unknown) => {
  const r = await publishTourismBatch(pool, raw);
  snapshots.push(r.snapshotId);
  return r;
};
const input = () => ({
  anchor: { latitude: place.latitude, longitude: place.longitude },
  regionId: 'furano',
  date: '2026-10-01',
  radius: 20000,
  interests: '',
});
const facility = (extra: any = {}) =>
  tourismRecord({
    titleJa: place.name_ja,
    latitude: place.latitude,
    longitude: place.longitude,
    ...extra,
  });
beforeAll(async () => {
  await migrate();
  original = (
    await pool.query('SELECT * FROM tourism_knowledge.source WHERE id=ANY($1::text[])', [sourceIds])
  ).rows;
  const fixtureId = randomUUID();
  const name = '観光テスト施設' + fixtureId;
  await pool.query(
    `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km)
    VALUES($1,'furano','ATTRACTION',$2,$2,43.34,142.39,ST_SetSRID(ST_MakePoint(142.39,43.34),4326)::geography,0)`,
    [fixtureId, name],
  );
  place = (await pool.query('SELECT * FROM geo_data.place WHERE id=$1', [fixtureId])).rows[0];
});
afterAll(async () => {
  for (const id of sourceIds) {
    const old = original.find((r) => r.id === id);
    if (old)
      await pool.query(
        'UPDATE tourism_knowledge.source SET active_snapshot_id=$2,enabled=$3,rights_status=$4 WHERE id=$1',
        [id, old.active_snapshot_id, old.enabled, old.rights_status],
      );
    else
      await pool.query('UPDATE tourism_knowledge.source SET active_snapshot_id=NULL WHERE id=$1', [
        id,
      ]);
  }
  await pool.query('DELETE FROM tourism_knowledge.snapshot WHERE id=ANY($1::uuid[])', [snapshots]);
  for (const id of sourceIds)
    if (!original.some((r) => r.id === id))
      await pool.query('DELETE FROM tourism_knowledge.source WHERE id=$1', [id]);
  if (place) await pool.query('DELETE FROM geo_data.place WHERE id=$1', [place.id]);
  await pool.end();
});
it('publishes atomically, matches an existing place and preserves attribution and leading-zero IDs', async () => {
  const raw = batch([facility()]);
  const result = await publish(raw);
  expect((await publishTourismBatch(pool, raw)).snapshotId).toBe(result.snapshotId);
  const found = await searchTourism(input());
  const e = found.evidence.find((e) => e.sourceId === 'furano-places')!;
  expect(e.externalId).toBe('0000000001');
  expect(e.placeId).toBe(place.id);
  expect(e.licenseId).toBe('CC-BY-4.0');
  expect(e.hoursStatus).toBe('historical');
  expect(e.sourceUpdatedAt).toBeNull();
});
it('rejects invalid batches and outdated fetches without replacing the last healthy snapshot', async () => {
  const active = (
    await pool.query(
      "SELECT active_snapshot_id FROM tourism_knowledge.source WHERE id='furano-places'",
    )
  ).rows[0].active_snapshot_id;
  for (const bad of [
    batch([facility({ latitude: 0 })]),
    batch([facility({ resourceUrl: 'http://127.0.0.1/private' })]),
    batch([facility({ resourceUrl: 'https://www.harp.lg.jp/opendata/dataset/1823/wrong.csv' })]),
    batch([facility(), facility()]),
    tourismBatch([facility()], 'furano-places', '2026-01-01T00:00:00Z'),
  ])
    await expect(publishTourismBatch(pool, bad)).rejects.toThrow();
  expect(
    (
      await pool.query(
        "SELECT active_snapshot_id FROM tourism_knowledge.source WHERE id='furano-places'",
      )
    ).rows[0].active_snapshot_id,
  ).toBe(active);
});
it('keeps unlocated tentative events as context and excludes ended/recurring events', async () => {
  const event = (id: string, extra: any = {}) =>
    tourismRecord({
      externalId: id,
      kind: 'event',
      regionId: 'new-chitose',
      resourceUrl: 'https://www.harp.lg.jp/opendata/dataset/1823/resource/8944/event2026.csv',
      latitude: null,
      longitude: null,
      locationStatus: 'missing',
      startDate: '2026-10-01',
      endDate: '2026-10-02',
      dateStatus: 'tentative',
      ...extra,
    });
  await publish(
    batch(
      [
        event('current'),
        event('ended', { startDate: '2026-09-01', endDate: '2026-09-02' }),
        event('recurring', { startDate: null, endDate: null, dateStatus: 'recurring' }),
      ],
      'eniwa-events',
    ),
  );
  const result = await searchTourism({ ...input(), regionId: 'new-chitose' });
  expect(
    result.evidence.filter((e) => e.sourceId === 'eniwa-events').map((e) => e.externalId),
  ).toEqual(['current']);
  expect(result.evidence[0].placeId).toBeNull();
  expect(result.evidence[0].startDate).toBe('2026-10-01');
  expect(result.evidence[0].dateStatus).toBe('tentative');
});
it('makes replacement snapshots visible as a whole and excludes stale validity and withdrawn records', async () => {
  const old = (await searchTourism(input())).snapshotIds;
  await publish(
    batch([
      facility({ externalId: 'replacement' }),
      facility({ externalId: 'expired', validUntil: '2026-09-30' }),
    ]),
  );
  const result = await searchTourism(input());
  expect(
    result.evidence.filter((e) => e.sourceId === 'furano-places').map((e) => e.externalId),
  ).toEqual(['replacement']);
  expect(
    (await searchTourism({ ...input(), snapshotIds: old })).evidence.filter(
      (e) => e.sourceId === 'furano-places',
    ),
  ).toEqual([]);
  await pool.query(
    "UPDATE tourism_knowledge.record SET withdrawn_at=now() WHERE snapshot_id=ANY($1::uuid[]) AND external_id='replacement'",
    [result.snapshotIds],
  );
  expect(
    (await searchTourism(input())).evidence.filter((e) => e.sourceId === 'furano-places'),
  ).toEqual([]);
});
it('enforces live rights revocation even with pinned snapshots and blocks publication', async () => {
  await publish(batch([facility({ externalId: 'allowed' })]));
  const pinned = (await searchTourism(input())).snapshotIds;
  await pool.query(
    "UPDATE tourism_knowledge.source SET rights_status='withdrawn' WHERE id='furano-places'",
  );
  try {
    expect(
      (await searchTourism({ ...input(), snapshotIds: pinned })).evidence.filter(
        (e) => e.sourceId === 'furano-places',
      ),
    ).toEqual([]);
    await expect(publishTourismBatch(pool, batch([facility()]))).rejects.toThrow('withdrawn');
  } finally {
    await pool.query(
      "UPDATE tourism_knowledge.source SET rights_status='approved' WHERE id='furano-places'",
    );
  }
});
it('does not link name-only facilities with missing coordinates', async () => {
  await publish(batch([facility({ latitude: null, longitude: null, locationStatus: 'missing' })]));
  expect(
    (await searchTourism(input())).evidence.find((e) => e.sourceId === 'furano-places')!.placeId,
  ).toBeNull();
});
it('keeps linked candidate evidence ahead of 120 unlinked records before limiting results', async () => {
  await publish(
    batch([
      ...Array.from({ length: 120 }, (_, i) =>
        facility({
          externalId: `unlinked-${String(i).padStart(3, '0')}`,
          latitude: null,
          longitude: null,
          locationStatus: 'missing',
        }),
      ),
      facility({ externalId: 'zz-linked' }),
    ]),
  );
  const found = await searchTourism(input());
  expect(found.candidates.some((p) => p.id === place.id)).toBe(true);
  const evidence = found.evidence.filter((e) => e.sourceId === 'furano-places');
  expect(evidence).toHaveLength(120);
  expect(evidence[0].externalId).toBe('zz-linked');
  expect(evidence[0].placeId).toBe(place.id);
});
it('excludes both explicit closed flags from spatial catalog candidates', async () => {
  try {
    for (const flag of ['column', 'tag']) {
      await pool.query(
        'UPDATE geo_data.place SET opening_hours=$2,osm_tags=$3::jsonb WHERE id=$1',
        [
          place.id,
          flag === 'column' ? 'closed' : null,
          JSON.stringify(flag === 'tag' ? { opening_hours: 'closed' } : {}),
        ],
      );
      expect((await searchTourism(input())).candidates.some((p) => p.id === place.id)).toBe(false);
    }
  } finally {
    await pool.query(
      'UPDATE geo_data.place SET opening_hours=NULL,osm_tags=$2::jsonb WHERE id=$1',
      [place.id, '{}'],
    );
  }
  expect((await searchTourism(input())).candidates.some((p) => p.id === place.id)).toBe(true);
});
