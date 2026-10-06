import { afterAll, expect, it, vi } from 'vitest';
import { operationBudget, abortable } from '../server/operation-budget';
import { createTourismGraph, type GraphInput } from '../server/ai/tourism-graph';
import { pool } from '../server/db';
const input: GraphInput = {
  requestId: 'test',
  userId: 'test',
  tripId: 'test',
  dayId: 'test',
  date: '2026-10-10',
  revision: 0,
  regionId: 'sapporo',
  transportMode: 'WALK',
  count: 3,
  keepPlaceIds: [],
  interests: '',
  items: [
    {
      id: 'old',
      name: 'old',
      nameJa: 'old',
      category: 'ATTRACTION',
      latitude: 43.06,
      longitude: 141.35,
      regionId: 'sapporo',
    },
  ],
};
afterAll(() => pool.end());
it('applies the whole operation deadline even when search never resolves', async () => {
  let signal: AbortSignal | undefined;
  const weather = vi.fn();
  const route = vi.fn();
  const graph = createTourismGraph({
    search: async (_, s) => {
      signal = s;
      return new Promise(() => {});
    },
    weather,
    route,
    requestTimeoutMs: 35,
  });
  const start = performance.now();
  await expect(graph.invoke({ input })).rejects.toMatchObject({
    code: 'REQUEST_DEADLINE_EXCEEDED',
  });
  expect(performance.now() - start).toBeLessThan(500);
  expect(signal?.aborted).toBe(true);
  expect(weather).not.toHaveBeenCalled();
  expect(route).not.toHaveBeenCalled();
});
it('client cancellation propagates into search without starting subsequent nodes', async () => {
  const parent = new AbortController();
  let started!: () => void;
  const entered = new Promise<void>((r) => (started = r));
  let signal: AbortSignal | undefined;
  const weather = vi.fn();
  const graph = createTourismGraph({
    search: async (_, s) => {
      signal = s;
      started();
      return new Promise(() => {});
    },
    weather,
    route: vi.fn(),
  });
  const running = graph.invoke({ input }, { signal: parent.signal });
  const rejected = expect(running).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  await entered;
  parent.abort();
  await rejected;
  expect(signal?.aborted).toBe(true);
  expect(weather).not.toHaveBeenCalled();
});
it('does not start work for an already aborted parent and tolerates late rejection', async () => {
  const parent = new AbortController();
  parent.abort();
  const budget = operationBudget(100, parent.signal);
  const work = vi.fn();
  await expect(abortable(work, budget.signal)).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  expect(work).not.toHaveBeenCalled();
  budget.dispose();
  const next = operationBudget(20);
  let reject!: (e: Error) => void;
  const running = abortable(() => new Promise<void>((_, r) => (reject = r)), next.signal);
  await expect(running).rejects.toMatchObject({ code: 'REQUEST_DEADLINE_EXCEEDED' });
  reject(Error('late upstream failure'));
  await new Promise((r) => setTimeout(r, 0));
  next.dispose();
});

it('cancels a pending provider preview on the parent deadline and stops launching queued segments', async () => {
  const candidates = Array.from({ length: 6 }, (_, i) => ({
    ...input.items[0],
    id: 'new-' + i,
    name: 'new-' + i,
    nameJa: 'new-' + i,
    latitude: 43.061 + i * 0.001,
  }));
  const routeSignals: AbortSignal[] = [];
  let started!: () => void;
  const entered = new Promise<void>((r) => (started = r));
  const parent = new AbortController();
  const graph = createTourismGraph({
    search: async () => ({ candidates, evidence: [], snapshotIds: [] }),
    weather: async () => ({ available: false }) as any,
    route: async (_a, _b, _mode, _fetch, _departure, signal) => {
      routeSignals.push(signal!);
      started();
      return new Promise(() => {});
    },
  });
  const running = graph.invoke(
    { input: { ...input, count: 6, strategy: 'NEARBY' } },
    { signal: parent.signal },
  );
  const rejected = expect(running).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  await entered;
  parent.abort();
  await rejected;
  expect(routeSignals.length).toBeGreaterThan(0);
  expect(routeSignals.every((s) => s.aborted)).toBe(true);
});
