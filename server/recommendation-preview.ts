export type PreviewSegment = {
  source: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
};
// Complete means all segments were routed, never that a whole-day timeline is feasible.
export function summarizeRecommendationRoutes(
  segments: readonly PreviewSegment[],
  mode: string,
  date: string,
) {
  const complete =
    segments.length > 0 &&
    segments.every(
      (s) =>
        ['valhalla', 'google'].includes(s.source) &&
        Number.isFinite(s.distanceMeters) &&
        Number.isFinite(s.durationSeconds) &&
        s.distanceMeters! >= 0 &&
        s.durationSeconds! >= 0,
    );
  return {
    complete,
    mode,
    timelineStatus: 'NOT_EVALUATED' as const,
    departureNotice: `각 구간은 ${date} 오전 9시(JST) 출발을 독립적으로 비교합니다. 장소 체류시간과 구간 사이의 시간 연결은 검증하지 않았어요.`,
    distanceMeters: complete ? segments.reduce((n, s) => n + s.distanceMeters!, 0) : null,
    durationSeconds:
      complete && mode !== 'TRANSIT' ? segments.reduce((n, s) => n + s.durationSeconds!, 0) : null,
  };
}
