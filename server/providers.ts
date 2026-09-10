import { straightDistance, dateOnly } from './domain.js';
type Point = { id: string; latitude: number; longitude: number };
export type Segment = {
  from: string;
  to: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  polyline: string | null;
  source: 'google' | 'straight-line';
  notice?: string;
  transitFare?: any;
  tolls?: any;
  departureTime?: string;
};
export function getGoogleKey() {
  return (
    process.env.GOOGLE_MAPS_SERVER_API_KEY ||
    (process.env.NODE_ENV === 'production' ? '' : process.env.VITE_GOOGLE_MAPS_API_KEY || '')
  );
}
export async function computeSegment(
  a: Point,
  b: Point,
  mode: string,
  request: typeof fetch = fetch,
  departureTime?: string,
): Promise<Segment> {
  const base = { from: a.id, to: b.id };
  try {
    const key = getGoogleKey();
    if (!key) throw new Error('KEY_MISSING');
    const response = await request('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      signal: AbortSignal.timeout(9000),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.travelAdvisory,routes.localizedValues.transitFare',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: a.latitude, longitude: a.longitude } } },
        destination: { location: { latLng: { latitude: b.latitude, longitude: b.longitude } } },
        travelMode: mode,
        ...(departureTime ? { departureTime } : {}),
        ...(mode === 'DRIVE'
          ? { routingPreference: 'TRAFFIC_AWARE', extraComputations: ['TOLLS'] }
          : {}),
        languageCode: 'ko',
        units: 'METRIC',
      }),
    });
    if (!response.ok) throw new Error('GOOGLE_UNAVAILABLE');
    const result = await response.json();
    const route = result.routes?.[0];
    if (!route || !Number.isFinite(route.distanceMeters)) throw new Error('NO_ROUTE');
    const seconds = Number.parseFloat(route.duration);
    return {
      ...base,
      distanceMeters: route.distanceMeters,
      durationSeconds: Number.isFinite(seconds) ? seconds : null,
      polyline: route.polyline?.encodedPolyline || null,
      source: 'google',
      transitFare:
        route.localizedValues?.transitFare?.text || route.travelAdvisory?.transitFare || null,
      tolls: route.travelAdvisory?.tollInfo || null,
      departureTime,
      notice: 'Google Routes · 요청 출발 시각 기준 예상, 요금 미제공은 무료를 뜻하지 않아요.',
    };
  } catch {
    return {
      ...base,
      distanceMeters: straightDistance(a, b),
      durationSeconds: null,
      polyline: null,
      source: 'straight-line',
      notice: '경로를 확인하지 못해 직선거리를 표시합니다. 실제 이동거리·시간과 다릅니다.',
    };
  }
}
export async function forecast(
  latitude: number,
  longitude: number,
  date: string,
  request: typeof fetch = fetch,
) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const offset = (Date.parse(date) - Date.parse(today)) / 86400000;
  if (!dateOnly.safeParse(date).success || offset < 0 || offset > 9)
    return {
      available: false,
      notice: '날씨 예보는 오늘부터 10일 이내의 일정에서 확인할 수 있어요.',
    };
  try {
    // Google Weather does not support daily forecasts in Japan.
    const query = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max',
      wind_speed_unit: 'kmh',
      timezone: 'Asia/Tokyo',
      forecast_days: '10',
    });
    const response = await request(`https://api.open-meteo.com/v1/forecast?${query}`, {
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error('UNAVAILABLE');
    const body = await response.json();
    const daily = body.daily,
      index = daily?.time?.indexOf(date) ?? -1;
    const high = daily?.temperature_2m_max?.[index],
      low = daily?.temperature_2m_min?.[index];
    if (index < 0 || !Number.isFinite(high) || !Number.isFinite(low)) throw new Error('NO_DATE');
    const code = daily.weather_code?.[index];
    const description =
      code === 0
        ? '맑음'
        : [1, 2].includes(code)
          ? '구름 조금'
          : code === 3
            ? '흐림'
            : [45, 48].includes(code)
              ? '안개'
              : [51, 53, 55, 56, 57].includes(code)
                ? '이슬비'
                : [61, 63, 65, 66, 67, 80, 81, 82].includes(code)
                  ? '비'
                  : [71, 73, 75, 77, 85, 86].includes(code)
                    ? '눈'
                    : [95, 96, 99].includes(code)
                      ? '뇌우'
                      : '예보';
    return {
      available: true,
      date,
      high,
      low,
      description,
      precipitationMm: daily.precipitation_sum?.[index] ?? null,
      snowfallCm: daily.snowfall_sum?.[index] ?? null,
      precipitationProbability: daily.precipitation_probability_max?.[index] ?? null,
      windSpeedKmh: daily.wind_speed_10m_max?.[index] ?? null,
      source: 'Open-Meteo',
      sourceUrl: 'https://open-meteo.com/',
    };
  } catch {
    return {
      available: false,
      notice: '지금은 날씨를 불러올 수 없어요. 잠시 후 다시 확인해주세요.',
    };
  }
}
