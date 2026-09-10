import { straightDistance } from './domain.js';
import { adverseWeather, indoorEvidence, weatherReason } from '../shared/weather-policy.js';
export const themes = [
  'weather',
  'indoor',
  'nature',
  'photo',
  'onsen',
  'food',
  'random',
  'nearby',
  'season',
  'japanese',
] as const;
export function recommend(
  places: any[],
  context: {
    theme: string;
    date: string;
    weather?: any;
    exclude?: string[];
    anchor?: { latitude: number; longitude: number };
    seed?: number;
  },
) {
  const month = Number(context.date.slice(5, 7)),
    winter = [12, 1, 2].includes(month);
  const wet = adverseWeather(context.weather);
  return places
    .filter((p) => !context.exclude?.includes(p.id))
    .map((p) => {
      const t = p.tags || {},
        inside = !!indoorEvidence(p);
      if (
        t.access === 'private' ||
        t.access === 'no' ||
        t.disused === 'yes' ||
        t.abandoned === 'yes' ||
        p.openingHours === 'closed'
      )
        return null;
      const nature =
        !!t.natural ||
        ['park', 'nature_reserve', 'garden'].includes(t.leisure) ||
        ['viewpoint', 'zoo'].includes(t.tourism);
      const photo = t.tourism === 'viewpoint' || !!t.historic || t.natural === 'waterfall';
      const onsen =
        t.amenity === 'public_bath' ||
        t.natural === 'hot_spring' ||
        t.bath_type === 'onsen' ||
        /温泉/.test(p.nameJa);
      const ski = !!t.piste || !!t['piste:type'] || t.sport === 'skiing';
      let match = false,
        reason = '',
        score = 0;
      switch (context.theme) {
        case 'weather':
          match = wet ? inside : nature;
          reason = context.weather?.available
            ? wet
              ? weatherReason(context.weather) + ' 예보에 맞춰 실내 근거가 확인된 후보를 골랐어요.'
              : '예보와 자연·공원 태그를 참고한 야외 여행 후보예요. 안전·개방 여부는 별도 확인하세요.'
            : '예보 범위 밖이거나 미수신 상태라 자연·공원 태그로 골랐어요.';
          break;
        case 'indoor':
          match = inside;
          reason =
            'OSM에 실내 이용 근거가 있는 후보예요. 운영시간과 이용 범위는 방문 전 확인하세요.';
          break;
        case 'nature':
          match = nature;
          reason = '자연 지형·공원·정원·전망대 태그가 있어요.';
          break;
        case 'photo':
          match = photo;
          reason = '전망대·역사 건축·폭포 태그가 있어 촬영 장소 후보로 골랐어요.';
          break;
        case 'onsen':
          match = onsen;
          reason = '온천 이름 또는 온천·목욕 시설 태그가 있어요.';
          break;
        case 'food':
          match = p.category === 'RESTAURANT';
          reason = '음식점으로 등록된 장소예요.';
          break;
        case 'japanese':
          match = p.category === 'RESTAURANT' || p.category === 'ATTRACTION';
          score = (p.nameKo ? 2 : 0) + (p.website ? 2 : 0) + (p.tags?.wikidata ? 1 : 0);
          reason = '일본어 리뷰 표본과 Google 전체 평점을 확인할 후보예요.';
          break;
        case 'nearby':
          match = !!context.anchor;
          reason = '';
          break;
        case 'season':
          match = winter ? ski || onsen : nature;
          reason = winter
            ? '겨울 취향에 맞는 스키·온천 후보예요. 운영기간은 별도 확인하세요.'
            : month + '월 여행의 야외·자연 취향 후보예요. 개화·단풍 현황을 확인한 추천은 아니에요.';
          break;
        case 'random':
          match = true;
          reason = '조건에 맞는 실제 장소 중 무작위로 골랐어요.';
          score = Math.random();
          break;
      }
      if (!match) return null;
      let distanceMeters: number | undefined;
      if (context.anchor) {
        distanceMeters = straightDistance(context.anchor, p);
        if (['nearby', 'route'].includes(context.theme) && distanceMeters > 20000) return null;
        score += Math.max(0, 20 - distanceMeters / 1000);
        if (!reason)
          reason =
            '현재 위치' +
            '에서 직선 ' +
            (distanceMeters / 1000).toFixed(1) +
            'km 떨어진 후보예요. 실제 우회 시간은 추가 후 경로에서 확인하세요.';
      }
      return { ...p, recommended: true, recommendationReasons: [reason], distanceMeters, score };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score || a.id.localeCompare(b.id));
}
