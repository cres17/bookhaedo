import type { auditTourismData } from './tourism-quality.js';
import { normalizedTourismName } from './tourism-matching.js';
type Audit = Awaited<ReturnType<typeof auditTourismData>>;

export function buildTourismComparison(audit: Audit, sourceId?: string) {
  if (sourceId && !audit.profile.some((source) => source.sourceId === sourceId))
    throw Error('Source has no active audited snapshot');
  const rows = audit.diagnostics
    .filter((record) => record.reason !== 'LINKED' && (!sourceId || record.sourceId === sourceId))
    .map((record) => ({
      sourceId: record.sourceId,
      externalId: record.externalId,
      snapshotId: record.snapshotId,
      title: record.title,
      regionId: record.regionId,
      latitude: record.latitude,
      longitude: record.longitude,
      resourceUrl: record.resourceUrl,
      contentSha256: record.contentSha256,
      evidencePointer: record.evidencePointer,
      reason: record.reason,
      candidates: record.nearby.map((candidate) => ({
        ...candidate,
        normalizedNameEqual:
          normalizedTourismName(candidate.name) === normalizedTourismName(record.title),
      })),
      sameNameOutsideRadiusOrRegion: record.sameName,
      decision: 'PENDING' as const,
      approvedPlaceId: null,
    }));
  return {
    checkedAt: audit.checkedAt,
    scope: 'Active unlinked facilities; candidate proximity is not proof of identity',
    matchingRadiusMeters: audit.matchingRadiusMeters,
    summary: rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.reason] = (counts[row.reason] ?? 0) + 1;
      return counts;
    }, {}),
    rows,
    matchingSql: audit.matchingSql,
    limits: [
      'Read-only comparison: no approved mapping or active snapshot is modified',
      'All decisions remain PENDING until source identity is reviewed and approved',
      'Nearby hotels, shops or related facilities may be different places',
      'No automatic alias, fuzzy-name or distance-only match is applied',
    ],
  };
}

export function formatTourismComparison(report: ReturnType<typeof buildTourismComparison>) {
  const escape = (value: unknown) =>
    String(value ?? '미제공')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\|/g, '\\|')
      .replace(/[\r\n]+/g, ' ');
  const rows = report.rows.map((row) => {
    const candidates =
      row.candidates
        .map(
          (candidate) =>
            `${escape(candidate.name)} (${candidate.distanceMeters.toFixed(1)}m, ${escape(candidate.category)}, ID: ${escape(candidate.id)})`,
        )
        .join('<br>') || '같은 지역의 250m 안 후보 없음';
    return `| ${escape(row.externalId)} | ${escape(row.title)} | ${escape(row.reason)} | ${candidates} | PENDING |`;
  });
  return `# 미연결 시설 대조 자료\n\n검사 시점: ${report.checkedAt}\n\n근처 후보는 동일 시설로 승인된 장소가 아닙니다. 모든 결정은 PENDING이며 연결은 변경하지 않습니다. 전체 후보를 표시합니다.\n\n| 외부 ID | 원문 시설 | 미연결 사유 | 같은 지역 250m 안 후보 (거리·분류·catalog ID) | 결정 |\n|---|---|---|---|---|\n${rows.join('\n')}\n`;
}
