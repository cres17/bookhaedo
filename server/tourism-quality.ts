import type { Pool } from 'pg';
import { dateOnly } from './domain.js';
import { sourceRegistry } from './tourism-knowledge.js';
import {
  matchTourismFacility,
  normalizedTourismName,
  TOURISM_MATCH_RADIUS_METERS,
  tourismNearbySql,
  type TourismMatchCandidate,
} from './tourism-matching.js';

type FacilityRow = {
  sourceId: string;
  externalId: string;
  title: string;
  placeId: string | null;
  regionId: string;
  latitude: number | null;
  longitude: number | null;
  snapshotId: string;
  resourceUrl: string;
  contentSha256: string;
  evidencePointer: string;
};
type SameNameCandidate = Pick<TourismMatchCandidate, 'id' | 'name' | 'regionId' | 'distanceMeters'>;

export const tourismProfileSql = `SELECT s.id AS "sourceId",v.id AS "snapshotId",
v.content_sha256 AS "contentSha256",v.fetched_at AS "fetchedAt",v.published_at AS "publishedAt",
s.enabled,s.rights_status AS "rightsStatus",v.record_count AS "declaredRecords",
count(r.external_id)::int AS records,
count(*) FILTER (WHERE r.kind='place')::int AS facilities,
count(*) FILTER (WHERE r.kind='event')::int AS events,
count(*) FILTER (WHERE r.kind='place' AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL)::int AS "facilitiesWithCoordinates",
count(*) FILTER (WHERE r.kind='place' AND r.canonical_place_id IS NOT NULL)::int AS "linkedFacilities",
count(*) FILTER (WHERE r.kind='event' AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL)::int AS "eventsWithCoordinates",
count(*) FILTER (WHERE r.kind='event' AND r.date_status IN ('confirmed','tentative') AND r.start_date<=$2::date AND r.end_date>=$2::date AND r.withdrawn_at IS NULL AND s.enabled AND s.rights_status='approved' AND v.fetched_at>=now()-interval '90 days' AND (r.valid_from IS NULL OR r.valid_from<=$2::date) AND (r.valid_until IS NULL OR r.valid_until>=$2::date))::int AS "eligibleEventsOnDate",
count(*) FILTER (WHERE r.kind='event' AND r.end_date<$2::date)::int AS "endedEventsBeforeDate",
count(*) FILTER (WHERE r.kind='event' AND (r.start_date IS NULL OR r.end_date IS NULL))::int AS "eventsWithoutExplicitPeriod",
count(*) FILTER (WHERE r.date_status='tentative')::int AS tentative,
count(*) FILTER (WHERE r.date_status='confirmed')::int AS "datesProvided",
count(*) FILTER (WHERE r.date_status='recurring')::int AS recurring,
count(*) FILTER (WHERE r.date_status='unknown')::int AS "unknownDates",
count(*) FILTER (WHERE r.hours_status='historical')::int AS "historicalHours",
count(*) FILTER (WHERE r.source_updated_at IS NULL)::int AS "unknownSourceUpdatedAt",
count(*) FILTER (WHERE r.withdrawn_at IS NOT NULL)::int AS withdrawn
FROM tourism_knowledge.source s JOIN tourism_knowledge.snapshot v ON v.id=s.active_snapshot_id
LEFT JOIN tourism_knowledge.record r ON r.snapshot_id=v.id
WHERE s.id=ANY($1::text[]) GROUP BY s.id,v.id ORDER BY s.id`;

export async function auditTourismData(
  pool: Pool,
  targetDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }),
) {
  const date = dateOnly.parse(targetDate);
  const approved = (await sourceRegistry())
    .filter((s) => s.enabled && s.rightsStatus === 'approved')
    .map((s) => s.id);
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const profile = (await db.query(tourismProfileSql, [approved, date])).rows.map((r) => ({
      ...r,
      facilityMatchRatePct: r.facilities ? (100 * r.linkedFacilities) / r.facilities : null,
      coordinateMatchRatePct: r.facilitiesWithCoordinates
        ? (100 * r.linkedFacilities) / r.facilitiesWithCoordinates
        : null,
    }));
    const facilities = (
      await db.query<FacilityRow>(
        `SELECT s.id AS "sourceId",r.external_id AS "externalId",
      r.title_ja AS title,r.canonical_place_id AS "placeId",r.region_id AS "regionId",r.latitude,r.longitude,
      r.snapshot_id AS "snapshotId",r.resource_url AS "resourceUrl",r.content_sha256 AS "contentSha256",r.evidence_pointer AS "evidencePointer"
      FROM tourism_knowledge.record r JOIN tourism_knowledge.source s ON s.active_snapshot_id=r.snapshot_id
      WHERE s.id=ANY($1::text[]) AND r.kind='place' ORDER BY s.id,r.external_id`,
        [approved],
      )
    ).rows;
    const names = new Map<string, string[]>();
    for (const p of (await db.query('SELECT id,name_ja FROM geo_data.place')).rows) {
      const key = normalizedTourismName(p.name_ja);
      names.set(key, [...(names.get(key) ?? []), p.id]);
    }
    const diagnostics = [];
    for (const r of facilities) {
      let reason = 'LINKED';
      let nearby: TourismMatchCandidate[] = [];
      let sameName: SameNameCandidate[] = [];
      if (!r.placeId) {
        const match = await matchTourismFacility(db, { ...r, kind: 'place' });
        reason = match.placeId ? 'ELIGIBLE_BUT_UNLINKED' : match.reason;
        nearby = match.nearby;
        if (match.reason !== 'MISSING_COORDINATES') {
          sameName = (
            await db.query<SameNameCandidate>(
              `SELECT id,name_ja AS name,region_id AS "regionId",
            ST_Distance(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS "distanceMeters"
            FROM geo_data.place WHERE id=ANY($1::text[]) ORDER BY "distanceMeters",id`,
              [names.get(normalizedTourismName(r.title)) ?? [], r.longitude, r.latitude],
            )
          ).rows;
          reason = match.placeId
            ? 'ELIGIBLE_BUT_UNLINKED'
            : match.reason === 'AMBIGUOUS_MATCH'
              ? match.reason
              : sameName.some((p) => p.regionId === r.regionId)
                ? 'DISTANCE_EXCEEDS_250M'
                : sameName.length
                  ? 'REGION_MISMATCH'
                  : match.reason;
        }
      }
      diagnostics.push({ ...r, reason, nearby, sameName });
    }
    const counts = (
      await db.query(`SELECT (SELECT count(*)::int FROM geo_data.place) AS "catalogPlaces",
      (SELECT count(*)::int FROM tourism_knowledge.snapshot) AS snapshots,
      (SELECT count(*)::int FROM tourism_knowledge.record) AS records`)
    ).rows[0];
    await db.query('COMMIT');
    return {
      checkedAt: new Date().toISOString(),
      targetDate: date,
      grain: 'sourceId + externalId in the active snapshot',
      matchingRule: `Exact NFKC/punctuation-normalized name + unique same-region catalog candidate within ${TOURISM_MATCH_RADIUS_METERS}m`,
      counts,
      profile,
      diagnostics,
      sql: tourismProfileSql,
      matchingSql: tourismNearbySql,
      matchingRadiusMeters: TOURISM_MATCH_RADIUS_METERS,
      limits: [
        'Automatic linkage is not a ground-truth identity validation',
        'Events are not automatically linked; facility rates exclude events',
        'Date status describes completeness/heuristics, not verified occurrence',
        'Fresh fetch does not establish current business hours or source update time',
      ],
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
