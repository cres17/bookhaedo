import { createHash } from 'node:crypto';
const DAY = 86400000;
export const jstDay = (value: string | number | Date) =>
  new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 10);
const shift = (day: string, n: number) =>
  new Date(Date.parse(day) + n * DAY).toISOString().slice(0, 10);
export function analyzeReviews(
  rows: any[],
  input: {
    googlePlaceId: string;
    startDate: string;
    endDate: string;
    scrapedAt: string;
    complete: boolean;
    maxResults: number;
  },
) {
  const seen = new Set<string>(),
    reviews: { day: string; rating: number }[] = [];
  let rejected = 0,
    duplicates = 0;
  for (const row of rows) {
    const time = Date.parse(row.timestamp),
      rating = row.rating;
    if (
      typeof row.timestamp !== 'string' ||
      row.placePlaceId !== input.googlePlaceId ||
      !Number.isFinite(time) ||
      time > Date.parse(input.scrapedAt) ||
      typeof rating !== 'number' ||
      rating < 1 ||
      rating > 5 ||
      !Number.isInteger(rating) ||
      !row.timestamp?.match(/T.*(?:Z|[+-]\d\d:\d\d)$/)
    ) {
      rejected++;
      continue;
    }
    const day = jstDay(time);
    if (day < input.startDate || day > input.endDate) {
      rejected++;
      continue;
    }
    // No author/body persisted. Author URL is used only transiently to disambiguate reviews.
    const identity =
      row.reviewId || row.reviewUrl || (row.authorUrl ? row.authorUrl + '|' + row.timestamp : null);
    if (!identity) {
      rejected++;
      continue;
    }
    const key = createHash('sha256')
      .update(input.googlePlaceId + '|' + identity)
      .digest('hex');
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    reviews.push({ day, rating });
  }
  const complete = input.complete && rows.length < input.maxResults && rejected === 0;
  const asOf = jstDay(input.scrapedAt),
    recentStart = shift(asOf, -30),
    previousStart = shift(asOf, -60),
    end = shift(asOf, -1);
  const covered = complete && input.startDate <= previousStart && input.endDate >= end;
  const recent = reviews.filter((r) => r.day >= recentStart && r.day <= end).length,
    previous = reviews.filter((r) => r.day >= previousStart && r.day < recentStart).length;
  const growth =
    covered && previous > 0 ? Math.round(((recent - previous) / previous) * 1000) / 10 : null;
  const trendType = !covered
    ? 'INSUFFICIENT_DATA'
    : previous >= 5 && recent >= 20 && growth !== null && growth >= 100
      ? 'RAPID_GROWTH'
      : previous >= 5 && recent >= 10 && growth !== null && growth >= 25
        ? 'INCREASING'
        : 'STABLE';
  const periods: any[] = [];
  for (const kind of ['WEEK', 'MONTH']) {
    const buckets = new Map<string, { count: number; sum: number }>();
    const bucket = (day: string) =>
      kind === 'MONTH'
        ? day.slice(0, 7) + '-01'
        : shift(day, -((new Date(day).getUTCDay() + 6) % 7));
    for (let d = input.startDate; d <= input.endDate; d = shift(d, 1))
      buckets.set(bucket(d), { count: 0, sum: 0 });
    for (const r of reviews) {
      const b = buckets.get(bucket(r.day))!;
      b.count++;
      b.sum += r.rating;
    }
    let previousBucket: any = null;
    for (const [start, b] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
      const next =
        kind === 'WEEK'
          ? shift(start, 7)
          : new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 1))
              .toISOString()
              .slice(0, 10);
      const full =
        complete && start >= input.startDate && shift(next, -1) <= input.endDate && next <= asOf;
      periods.push({
        periodType: kind,
        periodStart: start,
        reviewCount: b.count,
        averageRating: b.count ? Math.round((b.sum / b.count) * 100) / 100 : null,
        previousReviewCount: previousBucket?.complete && full ? previousBucket.reviewCount : null,
        growthRate:
          previousBucket?.complete && full && previousBucket.reviewCount > 0
            ? Math.round(
                ((b.count - previousBucket.reviewCount) / previousBucket.reviewCount) * 1000,
              ) / 10
            : null,
        complete: full,
      });
      previousBucket = periods.at(-1);
    }
  }
  const years = new Map<string, any[]>();
  for (const p of periods.filter((p) => p.periodType === 'MONTH' && p.complete)) {
    const y = p.periodStart.slice(0, 4);
    years.set(y, [...(years.get(y) || []), p]);
  }
  const fullYears = [...years.values()].filter(
    (months) => months.length === 12 && months.reduce((s, p) => s + p.reviewCount, 0) >= 60,
  );
  const patterns: string[] = [];
  if (fullYears.length >= 2)
    for (const [name, months] of [
      ['WINTER', [12, 1, 2]],
      ['SUMMER', [6, 7, 8]],
    ] as const) {
      if (
        fullYears.every((year) => {
          const season =
            year
              .filter((p) =>
                (months as readonly number[]).includes(Number(p.periodStart.slice(5, 7))),
              )
              .reduce((s, p) => s + p.reviewCount, 0) / 3;
          const other =
            year
              .filter(
                (p) => !(months as readonly number[]).includes(Number(p.periodStart.slice(5, 7))),
              )
              .reduce((s, p) => s + p.reviewCount, 0) / 9;
          return season >= 10 && season >= other * 1.5;
        })
      )
        patterns.push(name);
    }
  return {
    trendType,
    recentReviewCount: recent,
    previousReviewCount: previous,
    growthRate: growth,
    seasonalPatterns: patterns,
    periods,
    quality: {
      complete,
      comparisonCovered: covered,
      received: rows.length,
      accepted: reviews.length,
      rejected,
      duplicates,
      startDate: input.startDate,
      endDate: input.endDate,
      asOf,
      recentStart,
      previousStart,
      reason: covered
        ? '수집기에서 확인된 기간 내 작성량 비교 · 실제 방문객 수와 다릅니다.'
        : '기간 누락·수집 상한·검증 실패 또는 미확인 수집 범위로 증가율 판단을 보류합니다.',
      seasonReason:
        fullYears.length >= 2
          ? '완전한 연도별 계절 평균 비교'
          : '완전한 12개월 자료가 2개 연도 이상 필요합니다.',
    },
  };
}
export const trendMessage = (type: string) =>
  ({
    RAPID_GROWTH: '🔥 최근 관심 급증',
    INCREASING: '📈 최근 리뷰 증가',
    STABLE: '뚜렷한 리뷰 급증 없음',
    INSUFFICIENT_DATA: '리뷰 추이 자료 부족',
    STALE: '리뷰 통계 갱신 필요',
  })[type] || '리뷰 추이 자료 부족';
