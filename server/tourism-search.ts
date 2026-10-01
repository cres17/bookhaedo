import { sourceRegistry } from './tourism-knowledge.js';
import { pool } from './db.js';
import { placeSelect } from './domain.js';
export type Evidence = {
  id: string;
  snapshotId: string;
  sourceId: string;
  externalId: string;
  placeId: string | null;
  kind: 'place' | 'event';
  title: string;
  excerpt: string;
  publisher: string;
  sourceUrl: string;
  resourceUrl: string;
  licenseId: string;
  licenseUrl: string;
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  evidencePointer: string;
  startDate: string | null;
  endDate: string | null;
  dateStatus: string;
  hoursStatus: string;
  locationStatus: string;
  scheduleRaw: string;
};
export type SearchResult = { candidates: any[]; evidence: Evidence[]; snapshotIds: string[] };
export type TourismSearchInput = {
  anchor: { latitude: number; longitude: number };
  regionId: string;
  date: string;
  radius: number;
  interests: string;
  snapshotIds?: string[];
};
export async function searchTourism(input: TourismSearchInput): Promise<SearchResult> {
  const approvedSources = (await sourceRegistry())
    .filter((s) => s.enabled && s.rightsStatus === 'approved')
    .map((s) => s.id);
  // Pin active versions in one statement. Permission flags remain live on every retry.
  const snapshots =
    input.snapshotIds ??
    (
      await pool.query(
        `SELECT active_snapshot_id AS id
    FROM tourism_knowledge.source WHERE enabled AND rights_status='approved' AND active_snapshot_id IS NOT NULL AND id=ANY($1::text[])
    ORDER BY id`,
        [approvedSources],
      )
    ).rows.map((r) => r.id as string);
  const candidates = await pool.query(
    `SELECT ${placeSelect} FROM geo_data.place
    WHERE region_id=$1 AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,$4)
    AND category<>'LODGING' AND COALESCE(osm_tags->>'access','') NOT IN ('private','no')
    AND COALESCE(osm_tags->>'disused','')<>'yes' AND COALESCE(osm_tags->>'abandoned','')<>'yes'
    AND COALESCE(opening_hours,'')<>'closed' AND COALESCE(osm_tags->>'opening_hours','')<>'closed'
    ORDER BY location <-> ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,
    (name_ko IS NOT NULL) DESC,(website IS NOT NULL) DESC,id LIMIT 600`,
    [input.regionId, input.anchor.longitude, input.anchor.latitude, input.radius],
  );
  const knowledge = await pool.query(
    `SELECT r.*,to_char(r.start_date,'YYYY-MM-DD') AS start_date,to_char(r.end_date,'YYYY-MM-DD') AS end_date,s.id AS source_id,s.publisher,s.source_url,s.license_id,s.license_url,v.fetched_at
    FROM tourism_knowledge.record r JOIN tourism_knowledge.snapshot v ON v.id=r.snapshot_id
    JOIN tourism_knowledge.source s ON s.id=v.source_id
    WHERE r.snapshot_id=ANY($1::uuid[]) AND s.active_snapshot_id=r.snapshot_id
    AND s.id=ANY($6::text[]) AND s.enabled AND s.rights_status='approved' AND r.withdrawn_at IS NULL AND r.region_id=$2
    AND v.fetched_at>=now()-interval '90 days'
    AND (r.valid_from IS NULL OR r.valid_from<=$3::date) AND (r.valid_until IS NULL OR r.valid_until>=$3::date)
    AND (r.kind='event' OR r.canonical_place_id=ANY($5::text[]))
    AND (r.kind='place' OR (r.date_status IN ('confirmed','tentative') AND r.start_date<=$3::date AND r.end_date>=$3::date))
    ORDER BY (r.canonical_place_id=ANY($5::text[])) DESC NULLS LAST,
    ts_rank(r.search_text,plainto_tsquery('simple',$4)) DESC,r.external_id LIMIT 120`,
    [
      snapshots,
      input.regionId,
      input.date,
      input.interests,
      candidates.rows.map((p) => p.id),
      approvedSources,
    ],
  );
  const evidence: Evidence[] = knowledge.rows.map((r) => ({
    id: `${r.source_id}:${r.external_id}`,
    snapshotId: r.snapshot_id,
    sourceId: r.source_id,
    externalId: r.external_id,
    placeId: r.canonical_place_id,
    kind: r.kind,
    title: r.title_ja,
    excerpt: r.description_ja.slice(0, 1200),
    publisher: r.publisher,
    sourceUrl: r.source_url,
    resourceUrl: r.resource_url,
    licenseId: r.license_id,
    licenseUrl: r.license_url,
    fetchedAt: new Date(r.fetched_at).toISOString(),
    sourceUpdatedAt: r.source_updated_at ? new Date(r.source_updated_at).toISOString() : null,
    evidencePointer: r.evidence_pointer,
    startDate: r.start_date ? String(r.start_date) : null,
    endDate: r.end_date ? String(r.end_date) : null,
    dateStatus: r.date_status,
    hoursStatus: r.hours_status,
    locationStatus: r.location_status,
    scheduleRaw: r.schedule_raw,
  }));
  return { candidates: candidates.rows, evidence, snapshotIds: snapshots };
}
