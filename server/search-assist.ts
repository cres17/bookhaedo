import { getGoogleKey } from './providers.js';
import { pool } from './db.js';
import { placeSelect, regions } from './domain.js';
import { matchingPlace } from './place-details.js';
import { parsePlaceSearch } from './place-search.js';

// External names are only used transiently to locate existing catalog records.
export async function searchAssist(q: string, regionId?: string, request: typeof fetch = fetch) {
  const parsed = parsePlaceSearch(q, regionId),
    key = getGoogleKey();
  if (!key)
    return { data: [], status: 'UNAVAILABLE', notice: '외부 장소 검색을 사용할 수 없어요.' };
  const region = regions.find((r) => r.id === (parsed.regionIds[0] || regionId));
  try {
    const response = await request('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location',
      },
      body: JSON.stringify({
        textQuery: [q, region?.ja, '北海道'].filter(Boolean).join(' '),
        languageCode: 'ja',
        regionCode: 'JP',
        pageSize: 5,
        ...(region
          ? {
              locationBias: {
                circle: {
                  center: { latitude: region.latitude, longitude: region.longitude },
                  radius: 20000,
                },
              },
            }
          : {}),
      }),
    });
    if (!response.ok)
      return {
        data: [],
        status: 'UNAVAILABLE',
        notice: '외부 검색이 일시적으로 제한됐어요. 원문 이름으로 다시 검색해보세요.',
      };
    const data: any[] = [],
      seen = new Set();
    for (const google of (await response.json()).places || []) {
      if (!google.location) continue;
      const args: any[] = [google.location.longitude, google.location.latitude],
        conditions = ['ST_DWithin(location,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,150)'];
      if (parsed.regionIds.length) {
        args.push(parsed.regionIds);
        conditions.push('region_id=ANY($3::text[])');
      }
      if (parsed.kinds.length)
        conditions.push('(' + parsed.kinds.map((k) => k.sql).join(' OR ') + ')');
      const nearby = await pool.query(
        `SELECT ${placeSelect} FROM geo_data.place WHERE ${conditions.join(' AND ')} ORDER BY ST_Distance(location,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) LIMIT 10`,
        args,
      );
      const local = nearby.rows.find((p) => matchingPlace(p, google));
      if (local && !seen.has(local.id)) {
        seen.add(local.id);
        data.push(local);
      }
    }
    return {
      data,
      status: data.length ? 'MATCHED' : 'NO_MATCH',
      notice: data.length
        ? 'Google 이름 검색으로 수집 장소를 찾았어요. 목록과 지도는 동일한 저장 장소를 표시합니다.'
        : '외부 검색에서도 수집된 장소와 이름·위치가 일치하는 결과를 찾지 못했어요. 일본어 원문이나 다른 이름으로 검색해보세요.',
    };
  } catch {
    return {
      data: [],
      status: 'UNAVAILABLE',
      notice: '외부 검색에 연결하지 못했어요. 잠시 후 다시 시도해주세요.',
    };
  }
}
