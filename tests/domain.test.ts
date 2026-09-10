import { describe, it, expect, vi } from 'vitest';
import { dateOnly, orderInput, tripInput, straightDistance, addDate } from '../server/domain';
import { computeSegment, forecast } from '../server/providers';
describe('화이트박스: 날짜, 순서, 거리 계산', () => {
  it('윤년과 잘못된 날짜를 구분한다', () => {
    expect(dateOnly.safeParse('2024-02-29').success).toBe(true);
    expect(dateOnly.safeParse('2026-02-29').success).toBe(false);
    expect(dateOnly.safeParse('2026-13-01').success).toBe(false);
  });
  it('월말·연말을 넘어 날짜를 생성한다', () => {
    expect(addDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDate('2024-02-28', 1)).toBe('2024-02-29');
  });
  it('중복 장소와 30일을 넘는 여행을 거절한다', () => {
    const id = '761caacf-fd2a-5076-852c-65e876d063ff';
    expect(orderInput.safeParse({ placeIds: [id, id] }).success).toBe(false);
    expect(tripInput.safeParse({ title: '여행', startDate: '2026-09-08', days: 31 }).success).toBe(
      false,
    );
  });
  it('직선거리는 동일 지점에서 0이고 방향에 무관하다', () => {
    const a = { latitude: 43.0687, longitude: 141.3508 },
      b = { latitude: 43.197, longitude: 140.9937 };
    expect(straightDistance(a, a)).toBe(0);
    expect(straightDistance(a, b)).toBe(straightDistance(b, a));
    expect(straightDistance(a, b)).toBeGreaterThan(30000);
    expect(straightDistance(a, b)).toBeLessThan(34000);
  });
});
describe('화이트박스: Google 응답과 실패 분기', () => {
  const a = { id: 'a', latitude: 43.0687, longitude: 141.3508 },
    b = { id: 'b', latitude: 43.0599, longitude: 141.3475 };
  it('실제 경로 응답의 거리·시간·폴리라인을 반환한다', async () => {
    vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY', 'test');
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [
            { distanceMeters: 1530, duration: '360s', polyline: { encodedPolyline: 'abc' } },
          ],
        }),
      ),
    );
    const s = await computeSegment(a, b, 'DRIVE', request);
    expect(s).toMatchObject({
      source: 'google',
      distanceMeters: 1530,
      durationSeconds: 360,
      polyline: 'abc',
    });
    expect(JSON.parse(request.mock.calls[0]![1].body).travelMode).toBe('DRIVE');
    vi.unstubAllEnvs();
  });
  it('403과 경로 없음은 직선거리로 표시하며 시간을 추정하지 않는다', async () => {
    vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY', 'test');
    for (const response of [new Response('{}', { status: 403 }), new Response('{"routes":[]}')]) {
      const s = await computeSegment(a, b, 'DRIVE', vi.fn().mockResolvedValue(response));
      expect(s.source).toBe('straight-line');
      expect(s.durationSeconds).toBeNull();
      expect(s.notice).toContain('직선거리');
    }
    vi.unstubAllEnvs();
  });
  it('예보 범위 밖의 날짜에는 API를 호출하지 않는다', async () => {
    const request = vi.fn();
    const result = await forecast(43.06, 141.35, '2099-01-01', request);
    expect(result.available).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it('일본 날짜의 Open-Meteo 예보와 출처를 반환한다', async () => {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          daily: {
            time: [date],
            temperature_2m_max: [24],
            temperature_2m_min: [15],
            weather_code: [71],
          },
        }),
      ),
    );
    expect(await forecast(43.06, 141.35, date, request)).toMatchObject({
      available: true,
      high: 24,
      low: 15,
      description: '눈',
      source: 'Open-Meteo',
    });
    expect(String(request.mock.calls[0]![0])).toContain('api.open-meteo.com');
  });
  it('날씨 실패와 누락 기온을 정상 예보로 오인하지 않는다', async () => {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    for (const response of [
      new Response('{}', { status: 503 }),
      new Response(
        JSON.stringify({
          daily: { time: [date], temperature_2m_max: [null], temperature_2m_min: [15] },
        }),
      ),
    ])
      expect(
        (await forecast(43.06, 141.35, date, vi.fn().mockResolvedValue(response))).available,
      ).toBe(false);
  });
});
