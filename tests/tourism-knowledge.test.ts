import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, migrate } from '../server/db';
import {
  publishTourismBatch,
  sourceRegistry,
  syncTourismSources,
} from '../server/tourism-knowledge';
import { matchTourismFacility } from '../server/tourism-matching';
import { buildTourismComparison } from '../server/tourism-comparison';
import { auditTourismData } from '../server/tourism-quality';
import { searchTourism } from '../server/tourism-search';
import { withdrawTourismRecord } from '../server/tourism-withdrawal';
import { pruneTourismSnapshots } from '../server/tourism-maintenance';
import { tourismBatch, tourismRecord } from './tourism-fixtures';
const sourceIds = ['furano-places', 'furano-events', 'eniwa-events', 'sapporo-places'];
const snapshots: string[] = [];
const withdrawalIds = new Set<string>();
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
  await pool.query(
    'DELETE FROM tourism_knowledge.withdrawal WHERE source_id=ANY($1::text[]) AND external_id=ANY($2::text[])',
    [sourceIds, [...withdrawalIds]],
  );
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
  withdrawalIds.add('replacement');
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

it('publishes and audits the same unique normalized match without silently relinking an active snapshot', async () => {
  const record = facility({ titleJa: place.name_ja + '・' });
  const match = await matchTourismFacility(pool, { ...record, title: record.titleJa });
  expect(match.placeId).toBe(place.id);
  const published = await publish(batch([record]));
  expect(
    (
      await pool.query(
        'SELECT canonical_place_id FROM tourism_knowledge.record WHERE snapshot_id=$1',
        [published.snapshotId],
      )
    ).rows[0].canonical_place_id,
  ).toBe(match.placeId);
  // Only the newly created test snapshot is changed to simulate an older unlinked publication.
  await pool.query(
    'UPDATE tourism_knowledge.record SET canonical_place_id=NULL WHERE snapshot_id=$1',
    [published.snapshotId],
  );
  const audit = await auditTourismData(pool, '2026-10-01');
  expect(audit.diagnostics.find((r) => r.snapshotId === published.snapshotId)?.reason).toBe(
    'ELIGIBLE_BUT_UNLINKED',
  );
  const comparison = buildTourismComparison(audit, 'furano-places');
  expect(comparison.rows).toHaveLength(1);
  expect(comparison.rows[0]).toMatchObject({
    decision: 'PENDING',
    approvedPlaceId: null,
    candidates: expect.arrayContaining([
      expect.objectContaining({ id: place.id, normalizedNameEqual: true }),
    ]),
  });
  expect(
    (
      await pool.query(
        'SELECT canonical_place_id FROM tourism_knowledge.record WHERE snapshot_id=$1',
        [published.snapshotId],
      )
    ).rows[0].canonical_place_id,
  ).toBeNull();
});
it('keeps ambiguous nearby names unlinked in publication, audit and comparison', async () => {
  const duplicateId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km)
      VALUES($1,'furano','ATTRACTION',$2,$2,43.34001,142.39,ST_SetSRID(ST_MakePoint(142.39,43.34001),4326)::geography,0)`,
      [duplicateId, place.name_ja],
    );
    const published = await publish(batch([facility()]));
    const audit = await auditTourismData(pool, '2026-10-01');
    const diagnostic = audit.diagnostics.find((r) => r.snapshotId === published.snapshotId)!;
    expect(diagnostic).toMatchObject({ placeId: null, reason: 'AMBIGUOUS_MATCH' });
    expect(diagnostic.nearby.filter((p) => p.name === place.name_ja)).toHaveLength(2);
    expect(buildTourismComparison(audit, 'furano-places').rows[0]).toMatchObject({
      decision: 'PENDING',
      approvedPlaceId: null,
      reason: 'AMBIGUOUS_MATCH',
    });
  } finally {
    await pool.query('DELETE FROM geo_data.place WHERE id=$1', [duplicateId]);
  }
});

it('publishes the pinned Sapporo CSV profile and exposes linked source attribution', async () => {
  const source = (await sourceRegistry()).find((s) => s.id === 'sapporo-places')!;
  const id = randomUUID();
  const name = '札幌検証' + id;
  await pool.query(
    `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km)
  VALUES($1,'sapporo','ATTRACTION',$2,$2,43.06,141.35,ST_SetSRID(ST_MakePoint(141.35,43.06),4326)::geography,0)`,
    [id, name],
  );
  try {
    const raw = {
      ...batch(
        [
          tourismRecord({
            regionId: 'sapporo',
            titleJa: name,
            descriptionJa: '',
            latitude: 43.06,
            longitude: 141.35,
            resourceUrl: source.resourceUrl,
            scheduleRaw: '',
            hoursStatus: 'unknown',
          }),
        ],
        'sapporo-places',
      ),
      parserVersion: 'sapporo-csv-v1',
    };
    const published = await publish(raw);
    expect((await publishTourismBatch(pool, raw)).snapshotId).toBe(published.snapshotId);
    const found = await searchTourism({
      ...input(),
      anchor: { latitude: 43.06, longitude: 141.35 },
      regionId: 'sapporo',
    });
    expect(found.evidence.find((e) => e.sourceId === 'sapporo-places')).toMatchObject({
      placeId: id,
      licenseId: 'CC-BY-4.0',
      resourceUrl: source.resourceUrl,
      hoursStatus: 'unknown',
      sourceUpdatedAt: null,
    });
  } finally {
    await pool.query('DELETE FROM geo_data.place WHERE id=$1', [id]);
  }
});

it('reprocesses only unchanged active content while retaining fetchedAt and the old snapshot', async () => {
  const raw = batch([facility()]);
  const old = await publish(raw);
  await pool.query(
    'UPDATE tourism_knowledge.record SET canonical_place_id=NULL WHERE snapshot_id=$1',
    [old.snapshotId],
  );
  for (const bad of [
    { ...raw, fetchedAt: new Date(++time).toISOString() },
    { ...raw, records: [facility({ descriptionJa: 'changed' })] },
  ]) {
    await expect(publishTourismBatch(pool, bad, old.snapshotId)).rejects.toThrow(
      'unchanged active snapshot',
    );
  }
  await expect(publishTourismBatch(pool, raw, randomUUID())).rejects.toThrow(
    'unchanged active snapshot',
  );
  const next = await publishTourismBatch(pool, raw, old.snapshotId);
  snapshots.push(next.snapshotId);
  expect(next.snapshotId).not.toBe(old.snapshotId);
  const rows = (
    await pool.query(
      'SELECT id,fetched_at FROM tourism_knowledge.snapshot WHERE id=ANY($1::uuid[])',
      [[old.snapshotId, next.snapshotId]],
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => new Date(r.fetched_at).toISOString() === raw.fetchedAt)).toBe(true);
  expect(
    (
      await pool.query(
        'SELECT canonical_place_id FROM tourism_knowledge.record WHERE snapshot_id=$1',
        [old.snapshotId],
      )
    ).rows[0].canonical_place_id,
  ).toBeNull();
  expect(
    (
      await pool.query(
        'SELECT canonical_place_id FROM tourism_knowledge.record WHERE snapshot_id=$1',
        [next.snapshotId],
      )
    ).rows[0].canonical_place_id,
  ).toBe(place.id);
  await expect(publishTourismBatch(pool, raw, old.snapshotId)).rejects.toThrow(
    'unchanged active snapshot',
  );
});
it('never revives withdrawn source records through reprocessing', async () => {
  const externalId = 'review-existing-' + randomUUID();
  withdrawalIds.add(externalId);
  const raw = batch([facility({ externalId })]);
  const old = await publish(raw);
  await pool.query('UPDATE tourism_knowledge.record SET withdrawn_at=now() WHERE snapshot_id=$1', [
    old.snapshotId,
  ]);
  await expect(publishTourismBatch(pool, raw, old.snapshotId)).rejects.toThrow('withdrawn records');
  expect(
    (
      await pool.query(
        "SELECT active_snapshot_id FROM tourism_knowledge.source WHERE id='furano-places'",
      )
    ).rows[0].active_snapshot_id,
  ).toBe(old.snapshotId);
});

it('honors a direct SQL withdrawal that waits while reprocessing activates a replacement', async () => {
  const externalId = 'review-race-' + randomUUID();
  withdrawalIds.add(externalId);
  const raw = batch([facility({ externalId })]);
  const old = await publish(raw);
  const writer = await pool.connect();
  const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let withdrawal: Promise<any> | undefined;
  const facade = {
    connect: async () => {
      const db = await pool.connect();
      return {
        release: () => db.release(),
        query: async (sql: string, params: any[]) => {
          const result = await db.query(sql, params);
          if (sql.startsWith('SELECT 1 FROM tourism_knowledge.record')) {
            withdrawal = writer.query(
              'UPDATE tourism_knowledge.record SET withdrawn_at=now() WHERE snapshot_id=$1 AND external_id=$2',
              [old.snapshotId, externalId],
            );
            // Confirm an actual DB lock wait, rather than rely on timing alone.
            let blocked = false;
            for (let n = 0; n < 100; n++) {
              blocked = (
                await pool.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid])
              ).rows[0].blocked;
              if (blocked) break;
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
            expect(blocked).toBe(true);
          }
          return result;
        },
      };
    },
  };
  try {
    const next = await publishTourismBatch(facade as any, raw, old.snapshotId);
    snapshots.push(next.snapshotId);
    await withdrawal;
    expect(
      (
        await pool.query('SELECT withdrawn_at FROM tourism_knowledge.record WHERE snapshot_id=$1', [
          next.snapshotId,
        ])
      ).rows[0].withdrawn_at,
    ).not.toBeNull();
    expect(
      (await searchTourism(input())).evidence.some(
        (e) => e.sourceId === 'furano-places' && e.externalId === externalId,
      ),
    ).toBe(false);
  } finally {
    await withdrawal;
    writer.release();
  }
});

it('waits for an in-progress withdrawal and then refuses reprocessing', async () => {
  const externalId = 'review-withdraw-first-' + randomUUID();
  withdrawalIds.add(externalId);
  const raw = batch([facility({ externalId })]);
  const old = await publish(raw);
  const writer = await pool.connect();
  let pending: Promise<any> | undefined;
  try {
    await writer.query('BEGIN');
    await writer.query(
      'UPDATE tourism_knowledge.record SET withdrawn_at=now() WHERE snapshot_id=$1',
      [old.snapshotId],
    );
    pending = publishTourismBatch(pool, raw, old.snapshotId);
    const rejection = expect(pending).rejects.toThrow('withdrawn records');
    await writer.query('COMMIT');
    await rejection;
    expect(
      (
        await pool.query('SELECT active_snapshot_id FROM tourism_knowledge.source WHERE id=$1', [
          'furano-places',
        ])
      ).rows[0].active_snapshot_id,
    ).toBe(old.snapshotId);
  } finally {
    await writer.query('ROLLBACK');
    writer.release();
    await pending?.catch(() => {});
  }
});

it('retains stable-ID withdrawal through a newer fetch', async () => {
  const externalId = 'review-refresh-' + randomUUID();
  withdrawalIds.add(externalId);
  await publish(batch([facility({ externalId })]));
  await withdrawTourismRecord(pool, { sourceId: 'furano-places', externalId });
  const newer = await publish(batch([facility({ externalId })]));
  expect(
    (
      await pool.query('SELECT withdrawn_at FROM tourism_knowledge.record WHERE snapshot_id=$1', [
        newer.snapshotId,
      ])
    ).rows[0].withdrawn_at,
  ).not.toBeNull();
  // Clearing a snapshot flag does not undo the stable-ID withdrawal.
  await pool.query('UPDATE tourism_knowledge.record SET withdrawn_at=NULL WHERE snapshot_id=$1', [
    newer.snapshotId,
  ]);
  expect((await searchTourism(input())).evidence.some((e) => e.externalId === externalId)).toBe(
    false,
  );
});

it('keeps the withdrawal marker when retention removes an old snapshot', async () => {
  const sourceId = 'review-prune-' + randomUUID(),
    oldId = randomUUID(),
    newId = randomUUID();
  try {
    await pool.query(
      "INSERT INTO tourism_knowledge.source(id,publisher,source_url,license_id,license_url,rights_status,enabled) VALUES($1,'test','https://example.test','test','https://example.test','approved',true)",
      [sourceId],
    );
    for (const id of [oldId, newId])
      await pool.query(
        "INSERT INTO tourism_knowledge.snapshot(id,source_id,content_sha256,parser_version,fetched_at,record_count) VALUES($1,$2,$3,'harp-csv-v1',now(),1)",
        [id, sourceId, 'a'.repeat(64)],
      );
    await pool.query(
      "INSERT INTO tourism_knowledge.record(snapshot_id,external_id,kind,region_id,title_ja,description_ja,resource_url,content_sha256,evidence_pointer,location_status,date_status,hours_status) VALUES($1,'test-id','place','furano','test','','https://example.test',$2,'test','missing','unknown','unknown')",
      [oldId, 'a'.repeat(64)],
    );
    await pool.query('UPDATE tourism_knowledge.source SET active_snapshot_id=$2 WHERE id=$1', [
      sourceId,
      oldId,
    ]);
    await withdrawTourismRecord(pool, { sourceId, externalId: 'test-id' });
    await pool.query('UPDATE tourism_knowledge.source SET active_snapshot_id=$2 WHERE id=$1', [
      sourceId,
      newId,
    ]);
    await pool.query(
      "UPDATE tourism_knowledge.snapshot SET published_at=now()-interval '100 days' WHERE id=$1",
      [oldId],
    );
    const result = await pruneTourismSnapshots(pool, {
      apply: true,
      days: 1,
      keepLatest: 1,
      sourceId,
    });
    expect(result.candidates.map((r) => r.snapshotId)).toEqual([oldId]);
    expect(
      (
        await pool.query('SELECT 1 FROM tourism_knowledge.withdrawal WHERE source_id=$1', [
          sourceId,
        ])
      ).rowCount,
    ).toBe(1);
  } finally {
    await pool.query('UPDATE tourism_knowledge.source SET active_snapshot_id=NULL WHERE id=$1', [
      sourceId,
    ]);
    await pool.query('DELETE FROM tourism_knowledge.snapshot WHERE source_id=$1', [sourceId]);
    await pool.query('DELETE FROM tourism_knowledge.source WHERE id=$1', [sourceId]);
  }
});

it('rolls back both the withdrawal marker and record flags together', async () => {
  const externalId = 'review-rollback-' + randomUUID();
  withdrawalIds.add(externalId);
  const published = await publish(batch([facility({ externalId })]));
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('UPDATE tourism_knowledge.record SET withdrawn_at=now() WHERE snapshot_id=$1', [
      published.snapshotId,
    ]);
    expect(
      (
        await db.query('SELECT 1 FROM tourism_knowledge.withdrawal WHERE external_id=$1', [
          externalId,
        ])
      ).rowCount,
    ).toBe(1);
    await db.query('ROLLBACK');
    expect(
      (
        await pool.query('SELECT 1 FROM tourism_knowledge.withdrawal WHERE external_id=$1', [
          externalId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query('SELECT withdrawn_at FROM tourism_knowledge.record WHERE snapshot_id=$1', [
          published.snapshotId,
        ])
      ).rows[0].withdrawn_at,
    ).toBeNull();
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

it('allows only one of two simultaneous reprocess requests for the same active snapshot', async () => {
  const raw = batch([facility({ externalId: 'review-concurrent-' + randomUUID() })]);
  const old = await publish(raw);
  const results = await Promise.allSettled([
    publishTourismBatch(pool, raw, old.snapshotId),
    publishTourismBatch(pool, raw, old.snapshotId),
  ]);
  for (const result of results)
    if (result.status === 'fulfilled') snapshots.push(result.value.snapshotId);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
});

it('audits catalog drift on linked facilities without silently modifying the existing link', async () => {
  const published = await publish(
    batch([facility({ externalId: 'review-drift-' + randomUUID() })]),
  );
  try {
    await pool.query('UPDATE geo_data.place SET name_ja=$2 WHERE id=$1', [
      place.id,
      'changed-' + randomUUID(),
    ]);
    const report = await auditTourismData(pool);
    expect(report.diagnostics.find((r) => r.snapshotId === published.snapshotId)).toMatchObject({
      reason: 'LINK_REVIEW_REQUIRED',
      placeId: place.id,
      currentMatch: { placeId: null, reason: 'NAME_MISMATCH' },
    });
    expect(
      (
        await pool.query(
          'SELECT canonical_place_id FROM tourism_knowledge.record WHERE snapshot_id=$1',
          [published.snapshotId],
        )
      ).rows[0].canonical_place_id,
    ).toBe(place.id);
  } finally {
    await pool.query('UPDATE geo_data.place SET name_ja=$2 WHERE id=$1', [place.id, place.name_ja]);
  }
});

it('rejects unknown withdrawal IDs without persisting a block', async () => {
  const externalId = 'review-unknown-' + randomUUID();
  await expect(
    withdrawTourismRecord(pool, { sourceId: 'furano-places', externalId }),
  ).rejects.toThrow('Unknown active tourism record');
  expect(
    (
      await pool.query('SELECT 1 FROM tourism_knowledge.withdrawal WHERE external_id=$1', [
        externalId,
      ])
    ).rowCount,
  ).toBe(0);
});

it('returns the same rejected-alias diagnostic on publication, unchanged publication and audit', async () => {
  const reviewed = (await import('../server/tourism-matching')).approvedTourismAliases;
  const alias = (await reviewed()).find((a) => a.sourceId === 'furano-places')!;
  const raw = batch([
    facility({ externalId: alias.externalId, titleJa: alias.title, contentSha256: 'e'.repeat(64) }),
  ]);
  const result = await publish(raw);
  const expected = {
    sourceId: alias.sourceId,
    externalId: alias.externalId,
    placeId: alias.placeId,
    reason: 'ALIAS_SOURCE_CHANGED',
    changedFields: ['contentSha256'],
  };
  expect(result.aliasReviews).toEqual([expected]);
  const unchanged = await publishTourismBatch(pool, raw);
  expect(unchanged).toMatchObject({ unchanged: true, aliasReviews: [expected] });
  const audit = await auditTourismData(pool, '2026-10-01');
  expect(
    audit.diagnostics.find(
      (r) => r.sourceId === alias.sourceId && r.externalId === alias.externalId,
    )?.aliasReview,
  ).toEqual(expected);
  expect(
    (
      await pool.query(
        'SELECT canonical_place_id FROM tourism_knowledge.record WHERE snapshot_id=$1',
        [result.snapshotId],
      )
    ).rows[0].canonical_place_id,
  ).toBeNull();
});
