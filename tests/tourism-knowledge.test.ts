import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, migrate } from '../server/db';
import {
  publishTourismBatch,
  sourceRegistry,
  syncTourismSources,
} from '../server/tourism-knowledge';
import { auditTourismData } from '../server/tourism-quality';
import { searchTourism } from '../server/tourism-search';
import { tourismBatch, tourismRecord } from './tourism-fixtures';
const sourceIds = ['furano-places', 'furano-events', 'eniwa-events'];
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
        'UPDATE tourism_knowledge.source SET active_snapshot_id=$2,enabled=$3,rights_status=$4,publisher=$5,source_url=$6,license_id=$7,license_url=$8 WHERE id=$1',
        [
          id,
          old.active_snapshot_id,
          old.enabled,
          old.rights_status,
          old.publisher,
          old.source_url,
          old.license_id,
          old.license_url,
        ],
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
  const found = await searchTourism(input());
  expect(found.evidence.filter((e) => e.sourceId === 'furano-places')).toEqual([]);
  const record = await pool.query(
    'SELECT canonical_place_id FROM tourism_knowledge.record WHERE snapshot_id=$1',
    [snapshots.at(-1)],
  );
  expect(record.rows[0].canonical_place_id).toBeNull();
});
it('excludes unlinked facilities while retaining linked candidate evidence', async () => {
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
  expect(evidence).toHaveLength(1);
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

it('prioritizes linked facilities ahead of contextual events before applying the 120 record limit', async () => {
  await publish(batch([facility({ externalId: 'zz-linked' })]));
  await publish(
    batch(
      Array.from({ length: 120 }, (_, i) =>
        tourismRecord({
          externalId: `event-${i}`,
          kind: 'event',
          resourceUrl: 'https://www.harp.lg.jp/opendata/dataset/2208/resource/8258/events.csv',
          latitude: null,
          longitude: null,
          locationStatus: 'missing',
          startDate: '2026-10-01',
          endDate: '2026-10-02',
          dateStatus: 'confirmed',
        }),
      ),
      'furano-events',
    ),
  );
  const found = await searchTourism(input());
  expect(found.evidence).toHaveLength(120);
  expect(found.evidence[0].placeId).toBe(place.id);
  expect(found.evidence[0].externalId).toBe('zz-linked');
});

it('refreshes registry attribution even when publishing the identical batch leaves the snapshot unchanged', async () => {
  const raw = batch([facility()]);
  const previous = await publish(raw);
  await pool.query(`UPDATE tourism_knowledge.source SET publisher='old publisher',
    source_url='https://example.test/old',license_id='old license',license_url='https://example.test/license'
    WHERE id='furano-places'`);
  const repeated = await publishTourismBatch(pool, raw);
  expect(repeated).toMatchObject({ snapshotId: previous.snapshotId, unchanged: true });
  const source = (await sourceRegistry()).find((s) => s.id === 'furano-places')!;
  const stored = (
    await pool.query("SELECT * FROM tourism_knowledge.source WHERE id='furano-places'")
  ).rows[0];
  expect(stored).toMatchObject({
    publisher: source.publisher,
    source_url: source.sourceUrl,
    license_id: source.licenseId,
    license_url: source.licenseUrl,
    active_snapshot_id: previous.snapshotId,
  });
  const found = (await searchTourism(input())).evidence.find((e) => e.placeId === place.id)!;
  expect(found).toMatchObject({
    publisher: source.publisher,
    sourceUrl: source.sourceUrl,
    licenseId: source.licenseId,
    licenseUrl: source.licenseUrl,
  });
});

it.each(['withdrawn', 'disabled'])(
  'syncs attribution without undoing the database %s override',
  async (override) => {
    const active = await publish(batch([facility()]));
    await pool.query(
      `UPDATE tourism_knowledge.source SET publisher='old publisher',
    rights_status=$1,enabled=$2 WHERE id='furano-places'`,
      [override === 'withdrawn' ? 'withdrawn' : 'approved', override !== 'disabled'],
    );
    try {
      await syncTourismSources(pool);
      const stored = (
        await pool.query("SELECT * FROM tourism_knowledge.source WHERE id='furano-places'")
      ).rows[0];
      expect(stored).toMatchObject({
        publisher: '富良野市',
        rights_status: override === 'withdrawn' ? 'withdrawn' : 'approved',
        enabled: override !== 'disabled',
        active_snapshot_id: active.snapshotId,
      });
      expect(
        (await searchTourism(input())).evidence.filter((e) => e.sourceId === 'furano-places'),
      ).toEqual([]);
      await expect(publishTourismBatch(pool, batch([facility()]))).rejects.toThrow(
        'withdrawn or disabled',
      );
    } finally {
      await pool.query(
        "UPDATE tourism_knowledge.source SET rights_status='approved',enabled=true WHERE id='furano-places'",
      );
    }
  },
);

it('audits active facility linkage with explicit denominators and separate missing-coordinate reasons', async () => {
  const published = await publish(
    batch([
      facility({ externalId: 'audit-linked' }),
      facility({ externalId: 'audit-other-name', titleJa: '別施設' + randomUUID() }),
      facility({
        externalId: 'audit-no-coordinates',
        latitude: null,
        longitude: null,
        locationStatus: 'missing',
      }),
    ]),
  );
  const before = (
    await pool.query('SELECT active_snapshot_id FROM tourism_knowledge.source WHERE id=$1', [
      'furano-places',
    ])
  ).rows[0];
  const report = await auditTourismData(pool, '2026-10-01');
  const profile = report.profile.find((r) => r.sourceId === 'furano-places')!;
  expect(profile).toMatchObject({
    snapshotId: published.snapshotId,
    records: 3,
    facilities: 3,
    events: 0,
    facilitiesWithCoordinates: 2,
    linkedFacilities: 1,
    coordinateMatchRatePct: 50,
  });
  expect(profile.facilityMatchRatePct).toBeCloseTo(100 / 3);
  expect(
    report.diagnostics
      .filter((r) => r.sourceId === 'furano-places')
      .map((r) => [r.externalId, r.reason]),
  ).toEqual([
    ['audit-linked', 'LINKED'],
    ['audit-no-coordinates', 'MISSING_COORDINATES'],
    ['audit-other-name', 'NAME_MISMATCH'],
  ]);
  expect(
    (
      await pool.query('SELECT active_snapshot_id FROM tourism_knowledge.source WHERE id=$1', [
        'furano-places',
      ])
    ).rows[0],
  ).toEqual(before);
  await expect(auditTourismData(pool, '2026-02-30')).rejects.toThrow();
});
