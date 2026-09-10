function compactName(value: string = '') {
  return value
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}
const chainNames = [
  'マクドナルド',
  'かつや',
  'モスバーガー',
  '吉野家',
  'すき家',
  '松屋',
  'ケンタッキー',
  'ロッテリア',
  'ガスト',
  'サイゼリヤ',
  'ココス',
  'びっくりドンキー',
  'スターバックス',
  'インデアン',
  'ラッキーピエロ',
];
function chainRoot(value: string) {
  const name = compactName(value);
  return chainNames.map(compactName).find((root) => name.startsWith(root));
}
export function dedupePlaces<
  T extends {
    regionId: string;
    category: string;
    nameJa: string;
    latitude: number;
    longitude: number;
    tags?: Record<string, string>;
  },
>(places: T[]) {
  const counts = new Map<string, number>();
  for (const p of places) {
    const name = compactName(p.nameJa),
      base = [p.regionId, p.category, name].join('|');
    counts.set(base, (counts.get(base) || 0) + 1);
  }
  const seen = new Set<string>();
  return places.filter((p) => {
    const name = compactName(p.nameJa),
      base = [p.regionId, p.category, name].join('|'),
      brand = p.tags?.['brand:wikidata'] || p.tags?.brand,
      chain = chainRoot(p.nameJa);
    const key = brand
      ? [p.regionId, p.category, brand].join('|')
      : chain
        ? [p.regionId, p.category, chain].join('|')
        : (counts.get(base) || 0) >= 3
          ? base
          : [base, p.latitude.toFixed(3), p.longitude.toFixed(3)].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const chainSql = `CASE ${chainNames.map((name) => `WHEN normalized_name LIKE '${name}%' THEN '${name}'`).join(' ')} ELSE NULL END`;
export const dedupedPlaceCte = (where: string) => `WITH base AS (
 SELECT p.*,${chainSql} AS chain_key FROM geo_data.place p ${where}
), filtered AS (
 SELECT base.*,count(*) OVER(PARTITION BY region_id,category,normalized_name) AS same_name_count FROM base
), ranked AS (
 SELECT filtered.*,row_number() OVER(PARTITION BY region_id,category,
  CASE WHEN chain_key IS NOT NULL THEN chain_key
       WHEN same_name_count>=3 THEN normalized_name
       ELSE normalized_name||':'||round(latitude::numeric,3)::text||':'||round(longitude::numeric,3)::text END
  ORDER BY (name_ko IS NOT NULL) DESC,(osm_tags ? 'wikidata') DESC,(website IS NOT NULL) DESC,source_count DESC,id
 ) AS duplicate_rank
 FROM filtered
)`;
