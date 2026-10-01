import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Pool } from 'pg';
import { dateOnly, regions } from './domain.js';

const nullableDate = dateOnly.nullable();
const resourceUrl = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      u.host === 'www.harp.lg.jp' &&
      !u.username &&
      !u.password &&
      u.pathname.startsWith('/opendata/dataset/')
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
    parserVersion: z.literal('harp-csv-v1'),
    fetchedAt: z.iso.datetime({ offset: true }),
    records: z.array(tourismRecordInput).min(1).max(10000),
  })
  .strict();
export const sourceRegistry = async () =>
  JSON.parse(await readFile(new URL('../ops/tourism/sources.json', import.meta.url), 'utf8')) as {
    id: string;
    publisher: string;
    sourceUrl: string;
    licenseId: string | null;
    licenseUrl: string | null;
    rightsStatus: string;
    enabled: boolean;
    regionId?: string;
    kind?: string;
  }[];

// Conservative match: exact normalized name AND 250m; multiple matches remain unlinked.
export const normalizedTourismName = (name: string) =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\p{S}\s]/gu, '');
export async function publishTourismBatch(pool: Pool, raw: unknown) {
  const batch = tourismBatchInput.parse(raw);
  const source = (await sourceRegistry()).find((s) => s.id === batch.sourceId);
  if (
    !source?.enabled ||
    source.rightsStatus !== 'approved' ||
    !source.licenseId ||
    !source.licenseUrl
  )
    throw new Error('Source permission is not approved');
  if (new Set(batch.records.map((r) => r.externalId)).size !== batch.records.length)
    throw new Error('Ambiguous stable IDs');
  if (
    batch.records.some(
      (r) =>
        r.regionId !== source.regionId ||
        r.kind !== source.kind ||
        !new URL(r.resourceUrl).pathname.startsWith(
          new URL(source.sourceUrl).pathname.replace('.html', '/'),
        ),
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
    await db.query(
      `INSERT INTO tourism_knowledge.source
      (id,publisher,source_url,license_id,license_url,rights_status,enabled)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,
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
    if (
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
      let placeId: string | null = null;
      if (r.latitude !== null && r.kind === 'place') {
        const matches = await db.query(
          `SELECT id,name_ja FROM geo_data.place
          WHERE region_id=$1 AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,250)`,
          [r.regionId, r.longitude, r.latitude],
        );
        const exact = matches.rows.filter(
          (p) => normalizedTourismName(p.name_ja) === normalizedTourismName(r.titleJa),
        );
        if (exact.length === 1) placeId = exact[0].id;
      }
      await db.query(
        `INSERT INTO tourism_knowledge.record
        (snapshot_id,external_id,kind,region_id,canonical_place_id,title_ja,description_ja,resource_url,
        content_sha256,source_updated_at,evidence_pointer,latitude,longitude,location_status,
        start_date,end_date,timezone,date_status,schedule_raw,hours_status,valid_from,valid_until)
        VALUES(${Array.from({ length: 22 }, (_, i) => '$' + (i + 1)).join(',')})`,
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
