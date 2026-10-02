import { matchTourismFacility } from './tourism-matching.js';
export { normalizedTourismName } from './tourism-matching.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { dateOnly, regions } from './domain.js';

const nullableDate = dateOnly.nullable();
const resourceUrl = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      ((u.host === 'www.harp.lg.jp' && u.pathname.startsWith('/opendata/dataset/')) ||
        (u.host === 'ckan.pf-sapporo.jp' &&
          u.pathname.startsWith('/dataset/a467875c-db25-4477-ba1f-16964fc5a7bd/resource/'))) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  }, 'Unapproved resource URL');
export const tourismRecordInput = z
  .object({
    externalId: z.string().min(1).max(150),
    kind: z.enum(['place', 'event']),
    regionId: z.enum(regions.map((r) => r.id) as [string, ...string[]]),
    titleJa: z.string().min(1).max(500),
    descriptionJa: z.string().max(12000),
    resourceUrl,
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
    evidencePointer: z.string().min(1).max(1500),
    latitude: z.number().min(41).max(46.1).nullable(),
    longitude: z.number().min(137).max(147).nullable(),
    locationStatus: z.enum(['provided', 'missing']),
    startDate: nullableDate,
    endDate: nullableDate,
    timezone: z.literal('Asia/Tokyo'),
    dateStatus: z.enum(['confirmed', 'tentative', 'recurring', 'unknown']),
    scheduleRaw: z.string().max(12000),
    hoursStatus: z.enum(['historical', 'unknown']),
    validFrom: nullableDate,
    validUntil: nullableDate,
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      (r.latitude === null) !== (r.longitude === null) ||
      r.locationStatus !== (r.latitude === null ? 'missing' : 'provided')
    )
      ctx.addIssue({ code: 'custom', message: 'Incomplete coordinates' });
    if (r.startDate && r.endDate && r.startDate > r.endDate)
      ctx.addIssue({ code: 'custom', message: 'Reversed event dates' });
    if (r.validFrom && r.validUntil && r.validFrom > r.validUntil)
      ctx.addIssue({ code: 'custom', message: 'Reversed validity dates' });
    if (r.kind === 'event' && r.dateStatus === 'confirmed' && (!r.startDate || !r.endDate))
      ctx.addIssue({ code: 'custom', message: 'Confirmed event needs explicit dates' });
  });
export const tourismBatchInput = z
  .object({
    sourceId: z.string().min(1).max(100),
    parserVersion: z.enum(['harp-csv-v1', 'sapporo-csv-v1']),
    fetchedAt: z.iso.datetime({ offset: true }),
    records: z.array(tourismRecordInput).min(1).max(10000),
  })
  .strict();
export const sourceRegistry = async () =>
  JSON.parse(await readFile(new URL('../ops/tourism/sources.json', import.meta.url), 'utf8')) as {
    id: string;
    publisher: string;
    sourceUrl: string;
    resourceUrl?: string;
    parserVersion?: string;
    licenseId: string | null;
    licenseUrl: string | null;
    rightsStatus: string;
    enabled: boolean;
    regionId?: string;
    kind?: string;
  }[];

export type TourismSource = Awaited<ReturnType<typeof sourceRegistry>>[number];
async function syncSourceMetadata(db: Pick<PoolClient, 'query'>, source: TourismSource) {
  await db.query(
    `INSERT INTO tourism_knowledge.source
    (id,publisher,source_url,license_id,license_url,rights_status,enabled)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET
    publisher=EXCLUDED.publisher,source_url=EXCLUDED.source_url,
    license_id=EXCLUDED.license_id,license_url=EXCLUDED.license_url`,
    [
      source.id,
      source.publisher,
      source.sourceUrl,
      source.licenseId,
      source.licenseUrl,
      source.rightsStatus,
      source.enabled,
    ],
  );
}
export async function syncTourismSources(pool: Pool) {
  const sources = (await sourceRegistry())
    .filter((s) => s.enabled && s.rightsStatus === 'approved' && s.licenseId && s.licenseUrl)
    .sort((a, b) => a.id.localeCompare(b.id));
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const source of sources) {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('tourism-publish:' || $1))", [
        source.id,
      ]);
      await syncSourceMetadata(db, source);
    }
    await db.query('COMMIT');
    return { syncedSourceIds: sources.map((s) => s.id) };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export async function publishTourismBatch(pool: Pool, raw: unknown, reprocessSnapshotId?: string) {
  if (reprocessSnapshotId !== undefined) z.uuid().parse(reprocessSnapshotId);
  const batch = tourismBatchInput.parse(raw);
  const source = (await sourceRegistry()).find((s) => s.id === batch.sourceId);
  if (
    !source?.enabled ||
    source.rightsStatus !== 'approved' ||
    !source.licenseId ||
    !source.licenseUrl
  )
    throw new Error('Source permission is not approved');
  if (batch.parserVersion !== (source.parserVersion ?? 'harp-csv-v1'))
    throw new Error('Parser version is outside its registered source');
  if (new Set(batch.records.map((r) => r.externalId)).size !== batch.records.length)
    throw new Error('Ambiguous stable IDs');
  if (
    batch.records.some(
      (r) =>
        r.regionId !== source.regionId ||
        r.kind !== source.kind ||
        (source.resourceUrl && r.resourceUrl !== source.resourceUrl) ||
        new URL(r.resourceUrl).origin !== new URL(source.sourceUrl).origin ||
        (new URL(source.sourceUrl).host === 'www.harp.lg.jp'
          ? !new URL(r.resourceUrl).pathname.startsWith(
              new URL(source.sourceUrl).pathname.replace('.html', '/'),
            )
          : !source.resourceUrl),
    )
  )
    throw new Error('Record is outside its registered source');
  const fetchedTime = new Date(batch.fetchedAt).getTime();
  if (fetchedTime > Date.now() + 60000 || fetchedTime < Date.now() - 90 * 86400000)
    throw new Error('Fetch time is outside the publication window');
  const hash = createHash('sha256').update(JSON.stringify(batch.records)).digest('hex');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('tourism-publish:' || $1))", [source.id]);
    await syncSourceMetadata(db, source);
    const active = await db.query(
      `SELECT s.enabled,s.rights_status,v.id,v.content_sha256,v.fetched_at
      FROM tourism_knowledge.source s LEFT JOIN tourism_knowledge.snapshot v ON v.id=s.active_snapshot_id
      WHERE s.id=$1 FOR UPDATE OF s`,
      [source.id],
    );
    const previous = active.rows[0];
    if (!previous.enabled || previous.rights_status !== 'approved')
      throw new Error('Source withdrawn or disabled');
    if (previous.fetched_at && new Date(previous.fetched_at).getTime() > fetchedTime)
      throw new Error('Older fetch cannot replace a newer snapshot');
    const withdrawals = await db.query<{ external_id: string; withdrawn_at: Date }>(
      'SELECT external_id,withdrawn_at FROM tourism_knowledge.withdrawal WHERE source_id=$1 AND external_id=ANY($2::text[])',
      [source.id, batch.records.map((r) => r.externalId)],
    );
    const withdrawnAt = new Map(withdrawals.rows.map((r) => [r.external_id, r.withdrawn_at]));
    if (reprocessSnapshotId !== undefined) {
      if (
        previous.id !== reprocessSnapshotId ||
        previous.content_sha256 !== hash ||
        new Date(previous.fetched_at).getTime() !== fetchedTime
      )
        throw new Error(
          'Reprocessing requires the unchanged active snapshot, content and fetch time',
        );
      const withdrawn = await db.query(
        'SELECT 1 FROM tourism_knowledge.record WHERE snapshot_id=$1 AND withdrawn_at IS NOT NULL LIMIT 1',
        [previous.id],
      );
      if (withdrawn.rowCount || withdrawnAt.size)
        throw new Error('Cannot reprocess a snapshot with withdrawn records');
    }
    if (
      reprocessSnapshotId === undefined &&
      previous.content_sha256 === hash &&
      new Date(previous.fetched_at).getTime() === fetchedTime
    ) {
      await db.query('COMMIT');
      return { snapshotId: previous.id as string, records: batch.records.length, unchanged: true };
    }
    const snapshotId = randomUUID();
    await db.query(
      `INSERT INTO tourism_knowledge.snapshot
      (id,source_id,content_sha256,parser_version,fetched_at,record_count) VALUES($1,$2,$3,$4,$5,$6)`,
      [snapshotId, source.id, hash, batch.parserVersion, batch.fetchedAt, batch.records.length],
    );
    for (const r of batch.records) {
      const { placeId } = await matchTourismFacility(db, {
        ...r,
        sourceId: source.id,
        title: r.titleJa,
      });
      await db.query(
        `INSERT INTO tourism_knowledge.record
        (snapshot_id,external_id,kind,region_id,canonical_place_id,title_ja,description_ja,resource_url,
        content_sha256,source_updated_at,evidence_pointer,latitude,longitude,location_status,
        start_date,end_date,timezone,date_status,schedule_raw,hours_status,valid_from,valid_until,withdrawn_at)
        VALUES(${Array.from({ length: 23 }, (_, i) => '$' + (i + 1)).join(',')})`,
        [
          snapshotId,
          r.externalId,
          r.kind,
          r.regionId,
          placeId,
          r.titleJa,
          r.descriptionJa,
          r.resourceUrl,
          r.contentSha256,
          r.sourceUpdatedAt,
          r.evidencePointer,
          r.latitude,
          r.longitude,
          r.locationStatus,
          r.startDate,
          r.endDate,
          r.timezone,
          r.dateStatus,
          r.scheduleRaw,
          r.hoursStatus,
          r.validFrom,
          r.validUntil,
          withdrawnAt.get(r.externalId) ?? null,
        ],
      );
    }
    await db.query('UPDATE tourism_knowledge.source SET active_snapshot_id=$2 WHERE id=$1', [
      source.id,
      snapshotId,
    ]);
    await db.query('COMMIT');
    return { snapshotId, records: batch.records.length, unchanged: false };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
