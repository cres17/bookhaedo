type Candidate = { id: string; category: string; [key: string]: any };
// A documented confidence adjustment, not a Japanese-only average or a resident score.
export function reviewScore(rating: number, count: number) {
  return (rating * count + 3.5 * 20) / (count + 20);
}
export async function reviewRecommendations(
  candidates: Candidate[],
  inspect: (p: Candidate, signal: AbortSignal) => Promise<any>,
) {
  const queues = ['RESTAURANT', 'ATTRACTION'].map((category) =>
    candidates.filter((p) => p.category === category),
  );
  const selected: Candidate[] = [];
  while (selected.length < 6 && queues.some((q) => q.length))
    for (const queue of queues) {
      if (queue.length && selected.length < 6) selected.push(queue.shift()!);
    }
  const signal = AbortSignal.timeout(12000),
    results: any[] = [];
  let failed = 0,
    sampled = 0,
    cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const p = selected[cursor++]!;
      let d: any;
      try {
        d = await inspect(p, signal);
      } catch {
        failed++;
        continue;
      }
      if (!d.available) {
        failed++;
        continue;
      }
      sampled++;
      if (
        !d.reviewEvidence?.japaneseCount ||
        !Number.isFinite(d.rating) ||
        d.rating < 3.5 ||
        !Number.isFinite(d.reviewCount) ||
        d.reviewCount < 5 ||
        String(d.businessStatus).startsWith('CLOSED')
      )
        continue;
      results.push({
        ...p,
        recommended: true,
        reviewSummary: {
          rating: d.rating,
          reviewCount: d.reviewCount,
          japaneseCount: d.reviewEvidence.japaneseCount,
          sampleCount: d.reviewEvidence.sampleCount,
          score: Math.round(reviewScore(d.rating, d.reviewCount) * 100) / 100,
        },
        recommendationReasons: [
          `Google 전체 평점 ${d.rating}/5 · 전체 리뷰 ${d.reviewCount}개`,
          `제공 표본 ${d.reviewEvidence.sampleCount}개 중 일본어 원문 ${d.reviewEvidence.japaneseCount}개. 거주지·국적은 확인할 수 없어요.`,
        ],
      });
    }
  }
  await Promise.all([worker(), worker()]);
  results.sort((a, b) => b.reviewSummary.score - a.reviewSummary.score || a.id.localeCompare(b.id));
  return {
    data: results,
    status: results.length
      ? 'READY'
      : failed === selected.length && selected.length
        ? 'PROVIDER_UNAVAILABLE'
        : selected.length
          ? 'INSUFFICIENT_EVIDENCE'
          : 'NO_CANDIDATES',
    evidence: {
      candidateCount: candidates.length,
      inspected: selected.length,
      available: sampled,
      failed,
    },
    notice:
      '음식점·관광지 후보 최대 6곳을 확인합니다. 전체 평점 3.5 이상·리뷰 5개 이상·일본어 원문 표본이 있는 후보를 리뷰 수로 보정한 전체 평점순으로 표시합니다. 일본어 리뷰만의 평점·현지인 여부·숨은 명소 여부는 판단하지 않습니다.',
  };
}
