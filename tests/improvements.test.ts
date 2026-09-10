import { describe, it, expect, vi } from 'vitest';
import { recommend } from '../server/recommendations';
import { routeSegment } from '../server/routing';
import { matchingPlace, reviewEvidence, readPhotoToken } from '../server/place-details';
const a = { id: 'a', nameJa: '札幌市時計台', latitude: 43.0625, longitude: 141.3536 },
  b = { id: 'b', latitude: 43.0599, longitude: 141.3475 };
describe('개선 기능의 근거와 실패 분기', () => {
  it('장소 연결은 이름과 근거리 좌표가 모두 일치해야 한다', () => {
    expect(
      matchingPlace(a, {
        displayName: { text: a.nameJa },
        location: { latitude: a.latitude, longitude: a.longitude },
      }),
    ).toBe(true);
    expect(
      matchingPlace(a, {
        displayName: { text: '다른 장소' },
        location: { latitude: a.latitude, longitude: a.longitude },
      }),
    ).toBe(false);
    expect(
      matchingPlace(a, {
        displayName: { text: a.nameJa },
        location: { latitude: 35, longitude: 139 },
      }),
    ).toBe(false);
  });
  it('리뷰 번역 언어가 아닌 원문 언어를 분석하고 표본 한계를 알린다', () => {
    const e = reviewEvidence([
      { text: { languageCode: 'ko' }, originalText: { languageCode: 'ja' } },
      { text: { languageCode: 'en' } },
    ]);
    expect(e.japaneseCount).toBe(1);
    expect(e.japaneseRatio).toBe(0.5);
    expect(e.notice).toContain('국적');
    expect(reviewEvidence().japaneseRatio).toBeNull();
  });
  it('위조된 사진 토큰은 거절한다', () => {
    expect(() => readPhotoToken('bad.signature')).toThrow();
  });
  it('비 예보일 때 실내 후보를 고르고 이미 저장한 장소를 제외한다', () => {
    const places = [
      { ...a, category: 'ATTRACTION', tags: { tourism: 'museum' } },
      { ...b, category: 'ATTRACTION', tags: { leisure: 'park' } },
    ];
    const c = {
      theme: 'weather',
      date: '2026-09-08',
      weather: { available: true, description: '비' },
      exclude: [],
    };
    expect(recommend(places, c).map((p: any) => p.id)).toEqual(['a']);
    expect(recommend(places, { ...c, exclude: ['a'] })).toEqual([]);
  });
  it('주변 추천은 직선 후보로 설명한다', () => {
    const r = recommend([{ ...b, category: 'ATTRACTION', tags: {} }], {
      theme: 'nearby',
      date: '2026-09-08',
      anchor: a,
    });
    expect(r[0]?.recommendationReasons[0]).toContain('직선');
  });
  it('Valhalla 좌표 정밀도와 택시 시간만 반환한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          trip: {
            status: 0,
            summary: { length: 0.729, time: 158 },
            legs: [{ shape: '??_ibE_ibE' }],
          },
        }),
      ),
    );
    const r = await routeSegment(a, b, 'TAXI', fetcher);
    expect(r).toMatchObject({
      source: 'valhalla',
      distanceMeters: 729,
      durationSeconds: 158,
      estimatedCost: null,
    });
    expect(String(fetcher.mock.calls[0]![0])).toContain('valhalla');
  });
  it('대중교통에는 자동차 OSRM 경로를 사용하지 않는다', async () => {
    vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY', 'test');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ routes: [] })));
    const r = await routeSegment(a, b, 'TRANSIT', fetcher);
    expect(String(fetcher.mock.calls[0]![0])).toContain('routes.googleapis.com');
    expect(r.source).toBe('straight-line');
    vi.unstubAllEnvs();
  });
});
