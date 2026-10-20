import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { PoolClient } from 'pg';

export const TOURISM_MATCH_RADIUS_METERS = 250;
export const normalizedTourismName = (name: string) =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\p{S}\s]/gu, '');
export type TourismMatchInput = {
  sourceId?: string;
  externalId?: string;
  contentSha256?: string;
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
  latitude: number;
  longitude: number;
};
export const tourismNearbySql = `SELECT id,name_ja AS name,region_id AS "regionId",category,address,website,latitude,longitude,
ST_Distance(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS "distanceMeters"
FROM geo_data.place WHERE region_id=$1 AND ST_DWithin(location,
ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,$4) ORDER BY "distanceMeters",id`;

const aliasSchema = z
  .object({
    sourceId: z.string().min(1),
    externalId: z.string().min(1),
    title: z.string().min(1),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    regionId: z.string().min(1),
    placeId: z.string().min(1),
    catalogName: z.string().min(1),
    catalogWebsite: z.url().nullable(),
    catalogCategory: z.string().min(1),
    catalogAddress: z.string().min(1).nullable(),
    catalogLatitude: z.number().min(41).max(46.1),
    catalogLongitude: z.number().min(137).max(147),
    verifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    evidenceUrls: z.array(z.url()).min(1),
    reason: z.string().min(1),
  })
  .strict();
export type AliasReview = {
  sourceId: string;
  externalId: string;
  placeId: string;
  reason:
    | 'ALIAS_SOURCE_CHANGED'
    | 'ALIAS_CATALOG_CHANGED'
    | 'ALIAS_CANDIDATE_UNAVAILABLE'
    | 'ALIAS_AMBIGUOUS'
    | 'ALIAS_MISSING_COORDINATES';
  changedFields: string[];
};
export type TourismAlias = z.infer<typeof aliasSchema>;
export function parseTourismAliases(raw: unknown) {
  const aliases = z.array(aliasSchema).parse(raw);
  const keys = aliases.map((a) => `${a.sourceId}:${a.externalId}`);
  if (new Set(keys).size !== keys.length) throw Error('Duplicate approved alias');
  return aliases;
}
let aliasesPromise: Promise<TourismAlias[]> | undefined;
export function approvedTourismAliases() {
  return (aliasesPromise ??= readFile(
    new URL('../ops/tourism/approved-aliases.json', import.meta.url),
    'utf8',
  )
    .then((raw) => parseTourismAliases(JSON.parse(raw)))
    .catch((error) => {
      aliasesPromise = undefined;
      throw error;
    }));
}
// Exact unique name remains the default. Reviewed aliases fail closed when source/catalog changes.
export async function matchTourismFacility(
  db: Pick<PoolClient, 'query'>,
  input: TourismMatchInput,
  aliases?: readonly TourismAlias[],
) {
  if (input.kind !== 'place')
    return {
      placeId: null,
      reason: 'NOT_FACILITY' as const,
      nearby: [] as TourismMatchCandidate[],
    };
  const getReviewed = async () =>
    input.sourceId && input.externalId
      ? (aliases ?? (await approvedTourismAliases())).find(
          (a) => a.sourceId === input.sourceId && a.externalId === input.externalId,
        )
      : undefined;
  let reviewed: TourismAlias | undefined;
  const review = (
    reason: AliasReview['reason'],
    changedFields: string[] = [],
  ): AliasReview | undefined =>
    reviewed
      ? {
          sourceId: reviewed.sourceId,
          externalId: reviewed.externalId,
          placeId: reviewed.placeId,
          reason,
          changedFields,
        }
      : undefined;
  if (input.latitude === null || input.longitude === null) {
    reviewed = await getReviewed();
    return {
      placeId: null,
      reason: 'MISSING_COORDINATES' as const,
      aliasReview: review('ALIAS_MISSING_COORDINATES'),
      nearby: [] as TourismMatchCandidate[],
    };
  }
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
  // Exact matches do not depend on the alias file being available.
  if (exact.length === 1) return { placeId: exact[0].id, reason: 'MATCHED' as const, nearby };
  reviewed = await getReviewed();
  // A valid exact match remains sufficient even when an old alias fingerprint no longer matches.
  let aliasReview: AliasReview | undefined;
  if (reviewed && exact.length !== 1) {
    if (exact.length > 1) aliasReview = review('ALIAS_AMBIGUOUS');
    else {
      const sourceChanged = (['title', 'contentSha256', 'regionId'] as const).filter(
        (k) => input[k] !== reviewed[k],
      );
      if (sourceChanged.length) aliasReview = review('ALIAS_SOURCE_CHANGED', sourceChanged);
      else {
        const candidate = nearby.find((p) => p.id === reviewed.placeId);
        if (
          !candidate ||
          !(candidate.distanceMeters <= TOURISM_MATCH_RADIUS_METERS) ||
          candidate.regionId !== reviewed.regionId
        )
          aliasReview = review('ALIAS_CANDIDATE_UNAVAILABLE');
        else {
          const fields = {
            name: 'catalogName',
            website: 'catalogWebsite',
            category: 'catalogCategory',
            address: 'catalogAddress',
            latitude: 'catalogLatitude',
            longitude: 'catalogLongitude',
          } as const;
          const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(
            (k) => candidate[k] !== reviewed[fields[k]],
          );
          if (changed.length) aliasReview = review('ALIAS_CATALOG_CHANGED', changed);
          else return { placeId: candidate.id, reason: 'MATCHED_ALIAS' as const, nearby };
        }
      }
    }
  }
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
    ...(aliasReview ? { aliasReview } : {}),
  };
}
