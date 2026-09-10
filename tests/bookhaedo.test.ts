import { describe, it, expect, vi } from 'vitest';
import { analyzeReviews, jstDay } from '../server/review-trends';
import { decodeShape, routeSegment } from '../server/routing';
import { estimateCosts, costInput } from '../server/costs';
import { computeSegment } from '../server/providers';
const input = {
  googlePlaceId: 'ChIJtest',
  startDate: '2026-07-01',
  endDate: '2026-08-31',
  scrapedAt: '2026-09-01T03:00:00Z',
  complete: true,
  maxResults: 10000,
};
const row = (n: number, date: string) => ({
  placePlaceId: 'ChIJtest',
  timestamp: date + 'T03:00:00Z',
  rating: 4,
  reviewId: String(n),
});
describe('Book해도: 리뷰 품질과 교통비', () => {
  it('JST 날짜 경계를 사용한다', () => expect(jstDay('2026-08-31T15:01:00Z')).toBe('2026-09-01'));
  it('80 대 20은 4배, 증가율은 300%다', () => {
    const rows = [
      ...Array.from({ length: 80 }, (_, n) => row(n, '2026-08-20')),
      ...Array.from({ length: 20 }, (_, n) => row(100 + n, '2026-07-20')),
    ];
    expect(analyzeReviews(rows, input)).toMatchObject({
      trendType: 'RAPID_GROWTH',
      growthRate: 300,
      recentReviewCount: 80,
      previousReviewCount: 20,
    });
  });
  it('상한 도달·범위 미확인은 급증을 만들지 않는다', () => {
    const rows = Array.from({ length: 100 }, (_, n) => row(n, '2026-08-20'));
    for (const i of [
      { ...input, maxResults: 100 },
      { ...input, complete: false },
    ])
      expect(analyzeReviews(rows, i)).toMatchObject({
        trendType: 'INSUFFICIENT_DATA',
        growthRate: null,
      });
  });
  it('기준 0은 무한 증가율로 표시하지 않는다', () =>
    expect(analyzeReviews([row(1, '2026-08-20')], input).growthRate).toBeNull());
  it('중복 제거·타 장소·미래 날짜·무효 별점은 검증한다', () => {
    const r = analyzeReviews(
      [
        row(1, '2026-08-20'),
        row(1, '2026-08-20'),
        { ...row(2, '2026-08-20'), rating: 0 },
        { ...row(3, '2026-08-20'), placePlaceId: 'other' },
        row(4, '2027-01-01'),
      ],
      input,
    );
    expect(r.quality).toMatchObject({ accepted: 1, duplicates: 1, rejected: 3 });
    expect(r.trendType).toBe('INSUFFICIENT_DATA');
  });
  it('부분 월과 주는 비교에서 제외한다', () => {
    const r = analyzeReviews([], { ...input, startDate: '2026-07-15' });
    expect(
      r.periods.find((p) => p.periodType === 'MONTH' && p.periodStart === '2026-07-01')?.complete,
    ).toBe(false);
    expect(r.seasonalPatterns).toEqual([]);
  });
  it('2개 완전 연도에 반복되는 겨울 작성량만 계절성으로 표시한다', () => {
    const rows: any[] = [];
    for (const year of [2024, 2025])
      for (let month = 1; month <= 12; month++)
        for (let n = 0; n < ([1, 2, 12].includes(month) ? 30 : 5); n++)
          rows.push(row(rows.length, year + '-' + String(month).padStart(2, '0') + '-15'));
    expect(
      analyzeReviews(rows, {
        ...input,
        startDate: '2024-01-01',
        endDate: '2025-12-31',
        scrapedAt: '2026-01-01T03:00:00Z',
      }).seasonalPatterns,
    ).toEqual(['WINTER']);
  });
  it('연료비와 명시적 택시 요율만 계산한다', () => {
    expect(estimateCosts(60000, 3600, { fuelEfficiency: 12, fuelPrice: 180 }).fuel).toBe(900);
    expect(
      estimateCosts(2000, 600, {
        taxiBase: 600,
        taxiIncludedKm: 1,
        taxiPerKm: 200,
        taxiPerMinute: 0,
      }).taxi,
    ).toBe(800);
    expect(estimateCosts(1000, 60).fuel).toBeNull();
    expect(costInput.safeParse({ fuelEfficiency: 0 }).success).toBe(false);
  });
  it('Valhalla polyline6과 실패를 처리한다', async () => {
    expect(decodeShape('??_ibE_ibE')).toEqual([
      [0, 0],
      [0.1, 0.1],
    ]);
    expect(() => decodeShape('_')).toThrow();
    const p = { id: 'a', latitude: 43, longitude: 141 };
    const r = await routeSegment(
      p,
      { ...p, id: 'b' },
      'BICYCLE',
      vi.fn().mockRejectedValue(Error('offline')),
    );
    expect(r).toMatchObject({ source: 'straight-line', durationSeconds: null });
  });
  it('Google TRANSIT 운임은 있으면 전달하고 없으면 null이다', async () => {
    vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY', 'test');
    const p = { id: 'a', latitude: 43, longitude: 141 },
      request = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 1000,
                duration: '300s',
                localizedValues: { transitFare: { text: '¥210' } },
              },
            ],
          }),
        ),
      );
    const r = await computeSegment(p, p, 'TRANSIT', request, '2026-09-10T00:00:00Z');
    expect(r.transitFare).toBe('¥210');
    expect(JSON.parse(request.mock.calls[0]![1].body).departureTime).toBe('2026-09-10T00:00:00Z');
    vi.unstubAllEnvs();
  });
});
