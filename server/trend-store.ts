import { pool } from './db.js';
import { trendMessage, jstDay } from './review-trends.js';
export async function getTrend(placeId: string) {
  const q = await pool.query(
    'SELECT t.*,r.scraped_at FROM planner.place_review_trend t JOIN planner.review_import r ON r.id=t.import_id WHERE t.place_id=$1',
    [placeId],
  );
  if (!q.rowCount)
    return {
      trendType: 'INSUFFICIENT_DATA',
      message: trendMessage('INSUFFICIENT_DATA'),
      recentReviewCount: null,
      previousReviewCount: null,
      growthRate: null,
      periods: [],
      seasonalPatterns: [],
      quality: { reason: '아직 검증된 리뷰 시계열을 수집하지 않았어요.' },
    };
  const t = q.rows[0],
    stale = Date.parse(jstDay(new Date())) - Date.parse(t.quality.asOf) > 7 * 86400000,
    type = stale ? 'STALE' : t.trend_type;
  const periods = await pool.query(
    'SELECT period_type AS "periodType",period_start::text AS "periodStart",review_count AS "reviewCount",average_rating::float AS "averageRating",previous_review_count AS "previousReviewCount",growth_rate::float AS "growthRate",complete FROM planner.place_review_stats WHERE import_id=$1 ORDER BY period_start',
    [t.import_id],
  );
  return {
    trendType: type,
    message: trendMessage(type),
    recentReviewCount: t.recent_review_count,
    previousReviewCount: t.previous_review_count,
    growthRate: stale ? null : t.growth_rate === null ? null : Number(t.growth_rate),
    seasonalPatterns: stale ? [] : t.seasonal_patterns,
    periods: periods.rows,
    quality: t.quality,
    scrapedAt: t.scraped_at,
    calculatedAt: t.calculated_at,
    source: 'beatanalytics / Google Maps 비공식 PoC 집계',
  };
}
export async function addTrendBadges(places: any[]) {
  if (!places.length) return places;
  const q = await pool.query(
    "SELECT place_id,trend_type FROM planner.place_review_trend WHERE place_id=ANY($1::text[]) AND trend_type IN ('RAPID_GROWTH','INCREASING') AND (quality->>'comparisonCovered')::boolean IS TRUE AND (quality->>'asOf')::date >= (now() AT TIME ZONE 'Asia/Tokyo')::date-7",
    [places.map((p) => p.id)],
  );
  return places.map((p) => ({
    ...p,
    trendBadge: q.rows.find((t) => t.place_id === p.id)
      ? trendMessage(q.rows.find((t) => t.place_id === p.id).trend_type)
      : null,
  }));
}
