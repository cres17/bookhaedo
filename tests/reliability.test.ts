import { describe, it, expect, vi } from 'vitest';
import { parsePlaceSearch } from '../server/place-search';
import { recommend } from '../server/recommendations';
import { reviewRecommendations, reviewScore } from '../server/review-recommendations';
import { adverseWeather } from '../shared/weather-policy';

describe('검색·날씨 정책 회귀', () => {
  it('스스키노와 모이와산의 고유명사를 분류로 잘라내지 않는다', () => {
    for (const word of ['스스키노', '모이와산']) {
      const r = parsePlaceSearch('삿포로 ' + word);
      expect(r.text).toBe(word);
      expect(r.kinds).toEqual([]);
    }
    expect(parsePlaceSearch('삿포로 스키').kinds[0]?.id).toBe('ski');
  });
  it('강풍과 높은 강수확률은 발견과 일정에서 동일하게 실내로 판단한다', () => {
    for (const weather of [
      { available: true, description: '맑음', windSpeedKmh: 45 },
      { available: true, description: '흐림', precipitationProbability: 80 },
    ]) {
      expect(adverseWeather(weather)).toBe(true);
      const choices = recommend(
        [
          { id: 'park', category: 'ATTRACTION', tags: { leisure: 'park' } },
          { id: 'museum', category: 'ATTRACTION', tags: { tourism: 'museum' } },
          { id: 'closed', category: 'ATTRACTION', tags: { tourism: 'museum', access: 'private' } },
        ],
        { theme: 'weather', date: '2026-09-10', weather },
      );
      expect(choices.map((p) => p!.id)).toEqual(['museum']);
    }
  });
});
describe('리뷰 추천의 범위·품질·실패 상태', () => {
  const candidates = Array.from({ length: 16 }, (_, i) => ({
    id: String(i),
    category: i < 8 ? 'RESTAURANT' : 'ATTRACTION',
  }));
  const details = (rating = 4.5, reviewCount = 100) => ({
    available: true,
    rating,
    reviewCount,
    businessStatus: 'OPERATIONAL',
    reviewEvidence: { japaneseCount: 2, sampleCount: 5 },
  });
  it('최대 10곳, 음식점과 관광지를 함께 검사하고 보정 평점순으로 정렬한다', async () => {
    let active = 0,
      max = 0;
    const inspect = vi.fn(async (p: any) => {
      active++;
      max = Math.max(max, active);
      await Promise.resolve();
      active--;
      return details(p.id === '0' ? 3.6 : 4.5);
    });
    const r = await reviewRecommendations(candidates, inspect);
    expect(inspect).toHaveBeenCalledTimes(10);
    expect(r.data).toHaveLength(10);
    expect(r.evidence.inspected).toBe(10);
    expect(r.notice).toContain('최대 10곳');
    expect(max).toBeLessThanOrEqual(2);
    expect(new Set(r.data.map((p) => p.category)).size).toBe(2);
    expect(r.data.at(-1).id).toBe('0');
    expect(reviewScore(4.5, 100)).toBeGreaterThan(reviewScore(4.5, 5));
  });
  it('한 분류만 있어도 10곳까지 검사하고 후보가 적으면 있는 만큼만 반환한다', async () => {
    const onlyRestaurants = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      category: 'RESTAURANT',
    }));
    for (const [input, count] of [
      [onlyRestaurants, 10],
      [onlyRestaurants.slice(0, 3), 3],
    ] as const) {
      const inspect = vi.fn(async () => details());
      const result = await reviewRecommendations(input, inspect);
      expect(inspect).toHaveBeenCalledTimes(count);
      expect(result.data).toHaveLength(count);
    }
  });
  it('낮은 평점·폐업·일본어 표본 없음은 추천하지 않는다', async () => {
    const r = await reviewRecommendations(candidates.slice(0, 3), async (p) =>
      p.id === '0'
        ? details(2)
        : p.id === '1'
          ? { ...details(), businessStatus: 'CLOSED_PERMANENTLY' }
          : { ...details(), reviewEvidence: { japaneseCount: 0 } },
    );
    expect(r.data).toEqual([]);
    expect(r.status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('제공자 오류와 후보 없음은 다른 상태로 반환한다', async () => {
    expect(
      (await reviewRecommendations(candidates, async () => ({ available: false }))).status,
    ).toBe('PROVIDER_UNAVAILABLE');
    expect((await reviewRecommendations([], async () => details())).status).toBe('NO_CANDIDATES');
  });
});
