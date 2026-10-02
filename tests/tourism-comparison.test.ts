import { expect, it } from 'vitest';
import { buildTourismComparison, formatTourismComparison } from '../server/tourism-comparison';
const diagnostic = (id: string, reason = 'NAME_MISMATCH') => ({
  sourceId: 'furano-places',
  externalId: id,
  title: '施設|<script>\n名称',
  snapshotId: 'snapshot',
  resourceUrl: 'https://www.harp.lg.jp/opendata/dataset/2207.html',
  contentSha256: 'a'.repeat(64),
  evidencePointer: 'csv:ID=' + id,
  regionId: 'furano',
  latitude: 43,
  longitude: 142,
  placeId: null,
  reason,
  nearby: Array.from({ length: 5 }, (_, i) => ({
    id: 'p' + i,
    name: '別施設' + i,
    regionId: 'furano',
    category: 'ATTRACTION',
    distanceMeters: 10 + i,
    address: null,
    website: null,
  })),
  sameName: [],
  decision: 'APPROVED',
  approvedPlaceId: 'untrusted-input',
});
const audit = {
  checkedAt: '2026-10-01T00:00:00Z',
  profile: [{ sourceId: 'furano-places' }],
  diagnostics: [
    diagnostic('001'),
    diagnostic('002', 'NO_CATALOG_PLACE_WITHIN_250M'),
    diagnostic('linked', 'LINKED'),
  ],
  matchingSql: 'SELECT ...',
  matchingRadiusMeters: 250,
} as any;

it('keeps source evidence, every candidate and pending decisions without applying an input approval', () => {
  const report = buildTourismComparison(audit, 'furano-places');
  expect(report.rows).toHaveLength(2);
  expect(report.rows[0]).toMatchObject({
    externalId: '001',
    evidencePointer: 'csv:ID=001',
    decision: 'PENDING',
    approvedPlaceId: null,
  });
  expect(report.rows[0].candidates).toHaveLength(5);
  expect(
    report.rows[0].candidates.every((candidate) => candidate.normalizedNameEqual === false),
  ).toBe(true);
  expect(audit.diagnostics[0].approvedPlaceId).toBe('untrusted-input');
});
it('groups mismatch and coverage reasons without counting already linked facilities', () => {
  expect(buildTourismComparison(audit).summary).toEqual({
    NAME_MISMATCH: 1,
    NO_CATALOG_PLACE_WITHIN_250M: 1,
  });
});
it('escapes facility text in Markdown while retaining all candidate IDs', () => {
  const markdown = formatTourismComparison(buildTourismComparison(audit));
  expect(markdown).not.toContain('<script>');
  expect(markdown).toContain('&lt;script&gt;');
  expect(markdown).toContain('施設\\|');
  expect(markdown).toContain('ID: p4');
  expect(markdown).toContain('PENDING');
});
it('rejects a source without an active audited snapshot', () => {
  expect(() => buildTourismComparison(audit, 'unknown')).toThrow('active audited snapshot');
});

it('keeps linked facilities requiring review separate from the unlinked comparison list', () => {
  const drift = { ...diagnostic('drift', 'LINK_REVIEW_REQUIRED'), placeId: 'still-linked' };
  expect(buildTourismComparison({ ...audit, diagnostics: [drift] }).rows).toEqual([]);
});
