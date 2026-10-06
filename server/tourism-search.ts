import { sourceRegistry } from './tourism-knowledge.js';
import { readQuery } from './read-query.js';
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
export type SearchResult = {
  candidates: any[];
  evidence: Evidence[];
  snapshotIds: string[];
  referenceEvents?: Evidence[];
};
export type TourismSearchInput = {
  anchor: { latitude: number; longitude: number };
  regionId: string;
  date: string;
  radius: number;
  interests: string;
  snapshotIds?: string[];
};
export async function searchTourism(
  input: TourismSearchInput,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const query = (sql: string, values: unknown[]) => readQuery(sql, values, signal);
  const approvedSources = (await sourceRegistry())
    .filter((s) => s.enabled && s.rightsStatus === 'approved')
    .map((s) => s.id);
  // Pin active versions in one statement. Permission flags remain live on every retry.
  const snapshots =
    input.snapshotIds ??
    (
      await query(
        `SELECT active_snapshot_id AS id
    FROM tourism_knowledge.source WHERE enabled AND rights_status='approved' AND active_snapshot_id IS NOT NULL AND id=ANY($1::text[])
    ORDER BY id`,
        [approvedSources],
      )
    ).rows.map((r) => r.id as string);
  const candidates = await query(
    `SELECT ${placeSelect} FROM geo_data.place
    WHERE region_id=$1 AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,$4)
    AND category<>'LODGING' AND COALESCE(osm_tags->>'access','') NOT IN ('private','no')
    AND COALESCE(osm_tags->>'disused','')<>'yes' AND COALESCE(osm_tags->>'abandoned','')<>'yes'
    AND COALESCE(opening_hours,'')<>'closed' AND COALESCE(osm_tags->>'opening_hours','')<>'closed'
    ORDER BY location <-> ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,
    (name_ko IS NOT NULL) DESC,(website IS NOT NULL) DESC,id LIMIT 600`,
    [input.regionId, input.anchor.longitude, input.anchor.latitude, input.radius],
  );
  const knowledge = await query(
    `SELECT r.*,to_char(r.start_date,'YYYY-MM-DD') AS start_date,to_char(r.end_date,'YYYY-MM-DD') AS end_date,s.id AS source_id,s.publisher,s.source_url,s.license_id,s.license_url,v.fetched_at
    FROM tourism_knowledge.record r JOIN tourism_knowledge.snapshot v ON v.id=r.snapshot_id
    JOIN tourism_knowledge.source s ON s.id=v.source_id
    WHERE r.snapshot_id=ANY($1::uuid[]) AND s.active_snapshot_id=r.snapshot_id
    AND s.id=ANY($6::text[]) AND s.enabled AND s.rights_status='approved' AND r.withdrawn_at IS NULL AND NOT EXISTS (SELECT 1 FROM tourism_knowledge.withdrawal w WHERE w.source_id=s.id AND w.external_id=r.external_id) AND r.region_id=$2
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
  // Undated/recurring rows are regional reading only, never plan evidence or dated events.
  const reference = await query(
    `SELECT r.*,to_char(r.start_date,'YYYY-MM-DD') AS start_date,to_char(r.end_date,'YYYY-MM-DD') AS end_date,
    s.id AS source_id,s.publisher,s.source_url,s.license_id,s.license_url,v.fetched_at
    FROM tourism_knowledge.record r JOIN tourism_knowledge.snapshot v ON v.id=r.snapshot_id
    JOIN tourism_knowledge.source s ON s.id=v.source_id
    WHERE r.snapshot_id=ANY($1::uuid[]) AND s.active_snapshot_id=r.snapshot_id
    AND s.id=ANY($4::text[]) AND s.enabled AND s.rights_status='approved'
    AND r.withdrawn_at IS NULL AND NOT EXISTS (SELECT 1 FROM tourism_knowledge.withdrawal w WHERE w.source_id=s.id AND w.external_id=r.external_id) AND r.region_id=$2 AND v.fetched_at>=now()-interval '90 days'
    AND (r.valid_from IS NULL OR r.valid_from<=$3::date) AND (r.valid_until IS NULL OR r.valid_until>=$3::date)
    AND r.kind='event' AND r.date_status IN ('recurring','unknown')
    AND r.start_date IS NULL AND r.end_date IS NULL
    ORDER BY s.id,r.external_id LIMIT 20`,
    [snapshots, input.regionId, input.date, approvedSources],
  );
  const toEvidence = (r: any): Evidence => ({
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
  });
  return {
    candidates: candidates.rows,
    evidence: knowledge.rows.map(toEvidence),
    referenceEvents: reference.rows.map(toEvidence),
    snapshotIds: snapshots,
  };
}

// A fresh statement after slow providers is the response's rights/active-version validation boundary.
export async function revalidateTourismEvidenceAt(
  evidence: Evidence[],
  date: string,
  signal?: AbortSignal,
): Promise<{ evidence: Evidence[]; validatedAt: string | null }> {
  if (!evidence.length) return { evidence: [], validatedAt: null };
  const approved = (await sourceRegistry())
    .filter((s) => s.enabled && s.rightsStatus === 'approved')
    .map((s) => s.id);
  const result = await readQuery(
    `WITH matched AS (SELECT r.snapshot_id,s.id AS source_id,r.external_id,s.publisher,s.source_url,s.license_id,s.license_url
    FROM jsonb_to_recordset($1::jsonb) AS wanted(snapshot_id uuid,source_id text,external_id text,place_id text,kind text)
    JOIN tourism_knowledge.source s ON s.id=wanted.source_id
    JOIN tourism_knowledge.snapshot v ON v.id=wanted.snapshot_id AND v.source_id=s.id
    JOIN tourism_knowledge.record r ON r.snapshot_id=v.id AND r.external_id=wanted.external_id
    WHERE r.canonical_place_id IS NOT DISTINCT FROM wanted.place_id AND r.kind=wanted.kind AND s.id=ANY($2::text[]) AND s.enabled AND s.rights_status='approved' AND s.active_snapshot_id=v.id
    AND r.withdrawn_at IS NULL AND NOT EXISTS (SELECT 1 FROM tourism_knowledge.withdrawal w WHERE w.source_id=s.id AND w.external_id=r.external_id)
    AND v.fetched_at>=now()-interval '90 days'
    AND (r.valid_from IS NULL OR r.valid_from<=$3::date) AND (r.valid_until IS NULL OR r.valid_until>=$3::date)
    AND (r.kind='place' OR (r.date_status IN ('confirmed','tentative') AND r.start_date<=$3::date AND r.end_date>=$3::date)
      OR (r.date_status IN ('recurring','unknown') AND r.start_date IS NULL AND r.end_date IS NULL)))
    SELECT statement_timestamp() AS validated_at,COALESCE(jsonb_agg(matched),'[]'::jsonb) AS records FROM matched`,
    [
      JSON.stringify(
        evidence.map((e) => ({
          snapshot_id: e.snapshotId,
          source_id: e.sourceId,
          external_id: e.externalId,
          place_id: e.placeId,
          kind: e.kind,
        })),
      ),
      approved,
      date,
    ],
    signal,
  );
  const rows = new Map<string, any>(
    result.rows[0].records.map((r: any) => [`${r.snapshot_id}:${r.source_id}:${r.external_id}`, r]),
  );
  const selected = evidence.flatMap((e) => {
    const row = rows.get(`${e.snapshotId}:${e.sourceId}:${e.externalId}`);
    return row
      ? [
          {
            ...e,
            publisher: row.publisher,
            sourceUrl: row.source_url,
            licenseId: row.license_id,
            licenseUrl: row.license_url,
          },
        ]
      : [];
  });
  return { evidence: selected, validatedAt: new Date(result.rows[0].validated_at).toISOString() };
}

export async function revalidateTourismEvidence(
  evidence: Evidence[],
  date: string,
  signal?: AbortSignal,
) {
  return (await revalidateTourismEvidenceAt(evidence, date, signal)).evidence;
}
