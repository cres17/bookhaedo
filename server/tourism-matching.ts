import type { PoolClient } from 'pg';

export const TOURISM_MATCH_RADIUS_METERS = 250;
export const normalizedTourismName = (name: string) =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\p{S}\s]/gu, '');
export type TourismMatchInput = {
  kind: 'place' | 'event';
  title: string;
  regionId: string;
  latitude: number | null;
  longitude: number | null;
};
export type TourismMatchCandidate = {
  id: string;
  name: string;
  regionId: string;
  distanceMeters: number;
  category: string;
  address: string | null;
  website: string | null;
};
export const tourismNearbySql = `SELECT id,name_ja AS name,region_id AS "regionId",category,address,website,
ST_Distance(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS "distanceMeters"
FROM geo_data.place WHERE region_id=$1 AND ST_DWithin(location,
ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,$4) ORDER BY "distanceMeters",id`;

// One conservative rule for publication and auditing. No alias or manual decision is applied.
export async function matchTourismFacility(
  db: Pick<PoolClient, 'query'>,
  input: TourismMatchInput,
) {
  if (input.kind !== 'place')
    return {
      placeId: null,
      reason: 'NOT_FACILITY' as const,
      nearby: [] as TourismMatchCandidate[],
    };
  if (input.latitude === null || input.longitude === null)
    return {
      placeId: null,
      reason: 'MISSING_COORDINATES' as const,
      nearby: [] as TourismMatchCandidate[],
    };
  const nearby = (
    await db.query<TourismMatchCandidate>(tourismNearbySql, [
      input.regionId,
      input.longitude,
      input.latitude,
      TOURISM_MATCH_RADIUS_METERS,
    ])
  ).rows;
  const name = normalizedTourismName(input.title);
  const exact = nearby.filter((candidate) => normalizedTourismName(candidate.name) === name);
  return {
    placeId: exact.length === 1 ? exact[0].id : null,
    reason:
      exact.length === 1
        ? ('MATCHED' as const)
        : exact.length > 1
          ? ('AMBIGUOUS_MATCH' as const)
          : nearby.length
            ? ('NAME_MISMATCH' as const)
            : ('NO_CATALOG_PLACE_WITHIN_250M' as const),
    nearby,
  };
}
