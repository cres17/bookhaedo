import { checkedWebsite } from './website-check.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getGoogleKey } from './providers.js';
import { straightDistance } from './domain.js';
type LocalPlace = { nameJa: string; latitude: number; longitude: number };
function sign(s: string) {
  return createHmac('sha256', getGoogleKey()).update(s).digest('base64url');
}
function photoToken(name: string) {
  const body = Buffer.from(JSON.stringify({ name, expires: Date.now() + 600000 })).toString(
    'base64url',
  );
  return body + '.' + sign(body);
}
export function readPhotoToken(token: string) {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw Error('BAD_TOKEN');
  const expected = sign(body);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw Error('BAD_TOKEN');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (
    data.expires < Date.now() ||
    !/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(data.name)
  )
    throw Error('EXPIRED');
  return data.name as string;
}
export function reviewEvidence(reviews: any[] = []) {
  const ja = reviews.filter((r) => (r.originalText?.languageCode || r.text?.languageCode) === 'ja');
  return {
    sampleCount: reviews.length,
    japaneseCount: ja.length,
    japaneseRatio: reviews.length ? ja.length / reviews.length : null,
    notice:
      '한국어 우선 조회의 최대 5개 관련성순 리뷰 표본이라 언어 편향이 있을 수 있어요. 일본어는 거주지·국적을 뜻하지 않으며 전체 방문객 비율이나 최근 증가량을 추정할 수 없어요.',
  };
}
function normalized(s: string) {
  return s
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}
export function matchingPlace(local: LocalPlace, p: any) {
  if (!p.location) return false;
  const distance = straightDistance(local, {
    latitude: p.location.latitude,
    longitude: p.location.longitude,
  });
  const a = normalized(local.nameJa),
    b = normalized(p.displayName?.text || '');
  return distance <= 1200 && a.length >= 2 && ((a.includes(b) && b.length >= 2) || b.includes(a));
}
export async function placeDetails(
  local: LocalPlace,
  request: typeof fetch = fetch,
  options: { signal?: AbortSignal; reviewOnly?: boolean } = {},
) {
  try {
    const key = getGoogleKey();
    if (!key) return { available: false, notice: 'Google Places 키가 설정되지 않았어요.' };
    const signal = () =>
      options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(9000)])
        : AbortSignal.timeout(9000);
    const search = await request('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      signal: signal(),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location',
      },
      body: JSON.stringify({
        textQuery: local.nameJa + ' 北海道',
        languageCode: 'ja',
        regionCode: 'JP',
        pageSize: 3,
        locationBias: {
          circle: {
            center: { latitude: local.latitude, longitude: local.longitude },
            radius: 1500,
          },
        },
      }),
    });
    if (!search.ok)
      return {
        available: false,
        notice:
          'Google Places 상세정보를 불러오지 못했어요. API 사용 설정과 키 제한을 확인해주세요.',
      };
    const candidates = (await search.json()).places || [],
      matched = candidates.find((p: any) => matchingPlace(local, p));
    if (!matched)
      return {
        available: false,
        notice:
          '이름과 위치가 일치하는 Google 장소를 확인하지 못해 다른 장소의 정보를 연결하지 않았어요.',
      };
    const detail = await request(
      'https://places.googleapis.com/v1/places/' +
        encodeURIComponent(matched.id) +
        '?languageCode=ko&regionCode=JP',
      {
        signal: signal(),
        headers: {
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': options.reviewOnly
            ? 'id,rating,userRatingCount,reviews,businessStatus'
            : 'id,displayName,formattedAddress,location,regularOpeningHours,internationalPhoneNumber,websiteUri,rating,userRatingCount,reviews,photos,editorialSummary,priceLevel,googleMapsUri,primaryTypeDisplayName,businessStatus,attributions',
        },
      },
    );
    if (!detail.ok)
      return {
        available: false,
        notice: 'Google 상세정보 조회가 제한됐어요. 기본 장소 정보는 계속 볼 수 있어요.',
      };
    const d = await detail.json(),
      photo = d.photos?.[0];
    if (options.reviewOnly)
      return {
        available: true,
        rating: d.rating,
        reviewCount: d.userRatingCount,
        businessStatus: d.businessStatus,
        reviewEvidence: reviewEvidence(d.reviews),
      };
    return {
      available: true,
      googlePlaceId: d.id || matched.id,
      nameKo: /[가-힣]/.test(d.displayName?.text || '') ? d.displayName.text : null,
      nameOriginal: local.nameJa,
      address: d.formattedAddress || null,
      openingHours: d.regularOpeningHours?.weekdayDescriptions || [],
      businessStatus: d.businessStatus || null,
      phone: d.internationalPhoneNumber || null,
      website: await checkedWebsite(d.websiteUri),
      rating: d.rating ?? null,
      reviewCount: d.userRatingCount ?? null,
      priceLevel: d.priceLevel || null,
      description: d.editorialSummary?.text || null,
      category: d.primaryTypeDisplayName?.text || null,
      url: d.googleMapsUri,
      source: 'Google Maps',
      attributions: d.attributions || [],
      reviews: (d.reviews || []).map((r: any) => ({
        text: r.text?.text || r.originalText?.text || '',
        originalText: r.originalText?.text || '',
        language: r.originalText?.languageCode || r.text?.languageCode || null,
        translated: r.text?.languageCode !== r.originalText?.languageCode,
        rating: r.rating,
        author: r.authorAttribution?.displayName || 'Google 사용자',
        authorUri: r.authorAttribution?.uri,
        url: r.googleMapsUri,
        publishedAt: r.publishTime,
      })),
      reviewEvidence: reviewEvidence(d.reviews),
      photo: photo
        ? {
            url: '/api/place-photo?token=' + encodeURIComponent(photoToken(photo.name)),
            authors: photo.authorAttributions || [],
            sourceUrl: photo.googleMapsUri || d.googleMapsUri,
          }
        : null,
    };
  } catch {
    return {
      available: false,
      notice: '추가 정보를 잠시 불러오지 못했어요. 기본 정보와 공식 링크를 확인해주세요.',
    };
  }
}
export async function photoUrl(token: string) {
  const name = readPhotoToken(token),
    query = new URLSearchParams({
      key: getGoogleKey(),
      maxWidthPx: '1000',
      skipHttpRedirect: 'true',
    });
  const r = await fetch('https://places.googleapis.com/v1/' + name + '/media?' + query, {
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw Error('NO_PHOTO');
  const url = new URL((await r.json()).photoUri);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com'))
    throw Error('BAD_PHOTO');
  return url.href;
}
