import { straightDistance } from './domain.js';

export type RecommendationPlace = {
  id: string;
  name: string;
  nameJa: string;
  regionId: string;
  category: string;
  latitude: number;
  longitude: number;
  nameKo?: string | null;
  website?: string | null;
  openingHours?: string | null;
  tags?: Record<string, string> | null;
  note?: string;
};
export function eligibleRecommendationPlace(p: RecommendationPlace) {
  return (
    p.category !== 'LODGING' &&
    !['private', 'no'].includes(p.tags?.access ?? '') &&
    p.tags?.disused !== 'yes' &&
    p.tags?.abandoned !== 'yes' &&
    p.openingHours !== 'closed' &&
    p.tags?.opening_hours !== 'closed'
  );
}
const name = (p: RecommendationPlace) =>
  p.nameJa
    ?.normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
// Conservative local duplicate rule, not an alias or a global chain/brand merge.
export function sameRecommendationFacility(a: RecommendationPlace, b: RecommendationPlace) {
  return (
    a.id === b.id ||
    (a.regionId === b.regionId &&
      a.category === b.category &&
      !!name(a) &&
      name(a) === name(b) &&
      straightDistance(a, b) <= 10)
  );
}
export function uniqueRecommendationFacilities<T extends RecommendationPlace>(
  places: readonly T[],
  linked: ReadonlySet<string> = new Set(),
  kept: readonly T[] = [],
) {
  const quality = (p: RecommendationPlace) =>
    Number(!!p.nameKo) + Number(!!p.website) + Number(!!p.tags?.wikidata);
  const sorted = [...places].sort(
    (a, b) =>
      Number(linked.has(b.id)) - Number(linked.has(a.id)) ||
      quality(b) - quality(a) ||
      a.id.localeCompare(b.id),
  );
  const result: T[] = [];
  for (const p of sorted)
    if (
      !kept.some((k) => sameRecommendationFacility(k, p)) &&
      !result.some((k) => sameRecommendationFacility(k, p))
    )
      result.push(p);
  return result;
}
