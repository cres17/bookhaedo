import type { Pool } from 'pg';
import { dateOnly } from './domain.js';
import { normalizedTourismName, sourceRegistry } from './tourism-knowledge.js';

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
      await db.query(
        `SELECT s.id AS "sourceId",r.external_id AS "externalId",
      r.title_ja AS title,r.canonical_place_id AS "placeId",r.region_id AS "regionId",r.latitude,r.longitude
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
      let nearby: any[] = [];
      let sameName: any[] = [];
      if (!r.placeId) {
        if (r.latitude === null || r.longitude === null) reason = 'MISSING_COORDINATES';
        else {
          nearby = (
            await db.query(
              `SELECT id,name_ja AS name,ST_Distance(location,
            ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS "distanceMeters"
            FROM geo_data.place WHERE region_id=$1 AND ST_DWithin(location,
            ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,250) ORDER BY "distanceMeters",id`,
              [r.regionId, r.longitude, r.latitude],
            )
          ).rows;
          sameName = (
            await db.query(
              `SELECT id,name_ja AS name,region_id AS "regionId",
            ST_Distance(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS "distanceMeters"
            FROM geo_data.place WHERE id=ANY($1::text[]) ORDER BY "distanceMeters",id`,
              [names.get(normalizedTourismName(r.title)) ?? [], r.longitude, r.latitude],
            )
          ).rows;
          const exact = nearby.filter(
            (p) => normalizedTourismName(p.name) === normalizedTourismName(r.title),
          );
          reason =
            exact.length > 1
              ? 'AMBIGUOUS_MATCH'
              : exact.length === 1
                ? 'ELIGIBLE_BUT_UNLINKED'
                : sameName.some((p) => p.regionId === r.regionId)
                  ? 'DISTANCE_EXCEEDS_250M'
                  : sameName.length
                    ? 'REGION_MISMATCH'
                    : nearby.length
                      ? 'NAME_MISMATCH'
                      : 'NO_CATALOG_PLACE_WITHIN_250M';
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
      matchingRule:
        'Exact NFKC/punctuation-normalized name + unique same-region catalog candidate within 250m',
      counts,
      profile,
      diagnostics,
      sql: tourismProfileSql,
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
