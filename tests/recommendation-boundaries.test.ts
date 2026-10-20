import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildDayPlans } from '../server/day-alternatives';
import {
  createTourismGraph,
  formatTourismResult,
  type GraphInput,
} from '../server/ai/tourism-graph';
import { pool } from '../server/db';
const place = (id: string, latitude = 43.06, extra = {}) => ({
  id,
  name: id,
  nameJa: id,
  regionId: 'sapporo',
  category: 'ATTRACTION',
  latitude,
  longitude: 141.35,
  tags: { tourism: 'museum' },
  ...extra,
});
const old = place('old', 43.05);
const candidates = [place('a'), place('b', 43.061), place('c', 43.062)];
const input: GraphInput = {
  requestId: 'request',
  userId: 'user',
  tripId: 'trip',
  dayId: 'day',
  date: '2026-10-10',
  revision: 0,
  items: [old],
  regionId: 'sapporo',
  transportMode: 'WALK',
  count: 3,
  keepPlaceIds: [],
  interests: '',
};
const evidence = (p: any) => ({
  id: `s:${p.id}`,
  sourceId: 's',
  snapshotId: 'snapshot',
  externalId: p.id,
  placeId: p.id,
  kind: 'place',
  title: p.name,
  dateStatus: 'unknown',
});
const deps = (extra = {}) => ({
  search: vi.fn(async () => ({
    candidates,
    evidence: [evidence(candidates[0])],
    snapshotIds: ['snapshot'],
  })),
  weather: vi.fn(async () => ({ available: false })),
  route: vi.fn(async (a: any, b: any) => ({
    from: a.id,
    to: b.id,
    source: 'valhalla',
    distanceMeters: 1000,
    durationSeconds: 1800,
  })),
  ...extra,
});
afterAll(() => pool.end());
describe('shared recommendation boundaries', () => {
  it.each([{ openingHours: 'closed' }, { tags: { opening_hours: 'closed' } }])(
    'excludes explicit closure from every legacy strategy (%j)',
    (flags) => {
      const closed = place('closed', 43.05, { category: 'RESTAURANT', ...flags });
      const plans = buildDayPlans([closed, ...candidates], [old], { available: false }, 3);
      expect(plans.length).toBeGreaterThan(0);
      expect(plans.flatMap((p: any) => p.places.map((q: any) => q.id))).not.toContain('closed');
    },
  );
  it('keeps unknown hours eligible', () => {
    const normal = place('unknown-hours', 43.0501, { openingHours: null });
    expect(
      buildDayPlans([normal, ...candidates], [old], { available: false }, 3)
        .find((p: any) => p.id === 'NEARBY')!
        .places.map((p: any) => p.id),
    ).toContain(normal.id);
  });
  it.each([false, true])(
    'deduplicates a facility while keeping the evidence-bearing representative (reverse=%s)',
    async (reverse) => {
      const a = place('node', 43.06, { nameJa: '同一施設' });
      const b = { ...a, id: 'way' };
      const list = reverse ? [b, a, ...candidates] : [a, b, ...candidates];
      const s = await createTourismGraph(
        deps({
          search: async () => ({
            candidates: list,
            evidence: [evidence(b)],
            snapshotIds: ['snapshot'],
          }),
        }) as any,
      ).invoke({ input });
      const plan = s.plans.find((p: any) => p.id === 'KNOWLEDGE');
      expect(plan.places.map((p: any) => p.id)).toContain('way');
      expect(plan.places.map((p: any) => p.id)).not.toContain('node');
      expect(plan.evidenceIds).toContain('s:way');
    },
  );
  it('preserves distinct branches and same-name facilities at different coordinates', async () => {
    const branch1 = place('branch1', 43.06, {
      nameJa: '同一名称',
      tags: { tourism: 'museum', brand: 'shared-brand' },
    });
    const branch2 = { ...branch1, id: 'branch2', latitude: 43.063 };
    const s = await createTourismGraph(
      deps({
        search: async () => ({
          candidates: [branch1, branch2, ...candidates],
          evidence: [evidence(branch1), evidence(branch2)],
          snapshotIds: ['snapshot'],
        }),
      }) as any,
    ).invoke({ input });
    const ids = s.plans.find((p: any) => p.id === 'KNOWLEDGE').places.map((p: any) => p.id);
    expect(ids).toContain('branch1');
    expect(ids).toContain('branch2');
  });
  it('does not add another catalog ID for a kept facility or transfer its evidence', async () => {
    const alias = { ...old, id: 'old-alias' };
    const s = await createTourismGraph(
      deps({
        search: async () => ({
          candidates: [alias, ...candidates],
          evidence: [evidence(alias), evidence(candidates[0])],
          snapshotIds: ['snapshot'],
        }),
      }) as any,
    ).invoke({ input: { ...input, keepPlaceIds: [old.id] } });
    expect(s.plans.flatMap((p: any) => p.places.map((q: any) => q.id))).not.toContain(alias.id);
    expect(s.plans.flatMap((p: any) => p.evidenceIds)).not.toContain('s:old-alias');
  });
  it('does not advertise independent transit queries as a continuous total', async () => {
    const d = deps({
      route: vi.fn(async (a: any, b: any) => ({
        from: a.id,
        to: b.id,
        source: 'google',
        distanceMeters: 1000,
        durationSeconds: 1800,
      })),
    });
    const s = await createTourismGraph(d as any).invoke({
      input: { ...input, transportMode: 'TRANSIT', strategy: 'KNOWLEDGE' },
    });
    expect(s.preview.complete).toBe(true);
    expect(s.preview.timelineStatus).toBe('NOT_EVALUATED');
    expect(s.preview.durationSeconds).toBeNull();
    expect(s.preview.departureNotice).toContain('각 구간');
    expect(s.preview.segments.map((r: any) => r.durationSeconds)).toEqual([1800, 1800]);
  });
  it('still returns a non-transit segment-time total without claiming timeline feasibility', async () => {
    const s = await createTourismGraph(deps() as any).invoke({
      input: { ...input, strategy: 'KNOWLEDGE' },
    });
    expect(s.preview.durationSeconds).toBe(3600);
    expect(s.preview.timelineStatus).toBe('NOT_EVALUATED');
  });
  it('removes evidence and its knowledge preview after final withdrawal validation', async () => {
    let revoked = false;
    const d = deps({
      route: async (a: any, b: any) => {
        revoked = true;
        return {
          from: a.id,
          to: b.id,
          source: 'valhalla',
          distanceMeters: 1000,
          durationSeconds: 60,
        };
      },
      revalidate: vi.fn(async (es: any[]) => (revoked ? [] : es)),
    });
    const s = await createTourismGraph(d as any).invoke({
      input: { ...input, strategy: 'KNOWLEDGE' },
    });
    const result = formatTourismResult(input, s);
    expect(d.revalidate).toHaveBeenCalledOnce();
    expect(result.evidence).toEqual([]);
    expect(result.plans.map((p: any) => p.id)).not.toContain('KNOWLEDGE');
    expect(result.preview).toBeNull();
    expect(result.status).toBe('CATALOG_FALLBACK');
  });
});
