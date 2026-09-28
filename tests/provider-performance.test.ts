import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderCache, mapConcurrent } from '../server/provider-cache';
import { routeSegment } from '../server/routing';
import { computeSegment, forecast } from '../server/providers';
import { placeDetails } from '../server/place-details';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const points = ['a', 'b', 'c', 'd', 'x'].map((id, i) => ({
  id,
  latitude: 43 + i / 100,
  longitude: 141,
}));
const route = {
  trip: { status: 0, summary: { length: 1, time: 90 }, legs: [{ shape: '??_ibE_ibE' }] },
};

describe('bounded provider reuse', () => {
  it('coalesces concurrent requests, clones results, expires and evicts entries', async () => {
    let now = 0;
    const cache = new ProviderCache<{ values: number[] }>(100, 2, () => now);
    const load = vi.fn(async () => ({ values: [1] }));
    const results = await Promise.all(Array.from({ length: 20 }, () => cache.get('a', load)));
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.stats.joined).toBe(19);
    results[0]!.values.push(2);
    expect((await cache.get('a', load)).values).toEqual([1]);
    await cache.get('b', load);
    await cache.get('c', load);
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(4);
    now = 100;
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(5);
  });
  it('never retains failures or fallback values and clears rejected flights', async () => {
    const cache = new ProviderCache<boolean>(100);
    const fail = vi.fn(async () => {
      throw Error('offline');
    });
    await expect(cache.get('a', fail)).rejects.toThrow('offline');
    const load = vi.fn(async () => false);
    await cache.get('a', load, Boolean);
    await cache.get('a', load, Boolean);
    expect(load).toHaveBeenCalledTimes(2);
    expect(await cache.get('a', async () => true)).toBe(true);
  });
  it('retains no more than the configured number of pending keys', async () => {
    const cache = new ProviderCache<number>(0, 1);
    let release!: (value: number) => void;
    const first = cache.get(
      'a',
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    expect(await cache.get('b', async () => 2)).toBe(2);
    expect(cache.stats.bypass).toBe(1);
    release(1);
    await first;
  });
  it('limits concurrency and retains itinerary order', async () => {
    let active = 0,
      peak = 0;
    const result = await mapConcurrent([30, 5, 10, 1], 2, async (delay) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active--;
      return delay;
    });
    expect(peak).toBe(2);
    expect(result).toEqual([30, 5, 10, 1]);
  });
});

describe('provider call reductions without stale or incorrect reuse', () => {
  it('only reloads two adjacent segments when one stop changes', async () => {
    const request = vi.fn(async () => response(route));
    const run = (ids: number[]) =>
      mapConcurrent(ids.slice(1), 3, (id, i) =>
        routeSegment(points[ids[i]!]!, points[id]!, 'DRIVE', request, '2026-09-22T00:00:00Z'),
      );
    await run([0, 1, 2, 3]);
    expect(request).toHaveBeenCalledTimes(3);
    await run([0, 1, 2, 3]);
    expect(request).toHaveBeenCalledTimes(3);
    const edited = await run([0, 4, 2, 3]);
    expect(request).toHaveBeenCalledTimes(5);
    expect(edited.map((s) => [s.from, s.to])).toEqual([
      ['a', 'x'],
      ['x', 'c'],
      ['c', 'd'],
    ]);
  });
  it('separates mode, direction, coordinates, date, backend and expires routes', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => response(route));
    const a = points[0]!,
      b = points[1]!;
    await routeSegment(a, b, 'DRIVE', request, '2026-09-22T00:00:00Z');
    await routeSegment(a, b, 'WALK', request, '2026-09-22T00:00:00Z');
    await routeSegment(b, a, 'DRIVE', request, '2026-09-22T00:00:00Z');
    await routeSegment({ ...a, latitude: 44 }, b, 'DRIVE', request, '2026-09-22T00:00:00Z');
    await routeSegment(a, b, 'DRIVE', request, '2026-09-23T00:00:00Z');
    vi.stubEnv('VALHALLA_BASE_URL', 'https://example.test');
    await routeSegment(a, b, 'DRIVE', request, '2026-09-22T00:00:00Z');
    expect(request).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(300_001);
    await routeSegment(a, b, 'DRIVE', request, '2026-09-22T00:00:00Z');
    expect(request).toHaveBeenCalledTimes(7);
  });
  it('retries failed routes instead of caching straight-line fallback', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(Error('offline'))
      .mockImplementation(async () => response(route));
    expect((await routeSegment(points[0]!, points[1]!, 'DRIVE', request)).source).toBe(
      'straight-line',
    );
    expect((await routeSegment(points[0]!, points[1]!, 'DRIVE', request)).source).toBe('valhalla');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('reuses the 10-day weather response across dates but refreshes at expiry and JST midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T14:45:00Z'));
    const days = Array.from({ length: 10 }, (_, i) =>
      new Date(Date.parse('2026-09-22') + i * 86400000).toISOString().slice(0, 10),
    );
    const request = vi.fn(async () =>
      response({
        daily: {
          time: days,
          temperature_2m_max: days.map((_, i) => 20 + i),
          temperature_2m_min: days.map(() => 10),
        },
      }),
    );
    const values = await Promise.all(days.map((date) => forecast(43, 141, date, request)));
    expect(request).toHaveBeenCalledTimes(1);
    expect(values.map((v) => v.high)).toEqual(days.map((_, i) => 20 + i));
    await forecast(43, 141, days[1]!, request);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600_001);
    await forecast(43, 141, days[1]!, request);
    expect(request).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date('2026-09-22T15:00:00Z'));
    await forecast(43, 141, days[1]!, request);
    expect(request).toHaveBeenCalledTimes(3);
    await forecast(43, 141, days[0]!, request);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('coalesces Google routes only while in flight and distinguishes departure time', async () => {
    vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY', 'test');
    const request = vi.fn(async () =>
      response({ routes: [{ distanceMeters: 1000, duration: '90s' }] }),
    );
    const get = (time: string) => computeSegment(points[0]!, points[1]!, 'TRANSIT', request, time);
    await Promise.all([
      get('2026-09-22T00:00:00Z'),
      get('2026-09-22T00:00:00Z'),
      get('2026-09-22T01:00:00Z'),
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    await get('2026-09-22T00:00:00Z');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('does not retain incomplete forecasts and separates locations', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T00:00:00Z'));
    const request = vi.fn(async () =>
      response({
        daily: {
          time: ['2026-09-22'],
          temperature_2m_max: [20],
          temperature_2m_min: [10],
        },
      }),
    );
    await forecast(43, 141, '2026-09-22', request);
    await forecast(43, 141, '2026-09-22', request);
    await forecast(44, 141, '2026-09-22', request);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('does not let a cancelled place search cancel another caller', async () => {
    vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY', 'test');
    const local = { nameJa: '札幌市時計台', latitude: 43, longitude: 141 };
    const controller = new AbortController();
    let started!: () => void;
    const searchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const request = vi.fn(async (url: any, init?: RequestInit) => {
      if (!String(url).includes('searchText')) return response({ id: 'place-id', rating: 4 });
      if (request.mock.calls.length === 1) {
        started();
        await new Promise((_, reject) =>
          init!.signal!.addEventListener('abort', () => reject(Error('cancelled')), { once: true }),
        );
      }
      return response({
        places: [{ id: 'place-id', displayName: { text: local.nameJa }, location: local }],
      });
    });
    const cancelled = placeDetails(local, request, { signal: controller.signal, reviewOnly: true });
    await searchStarted;
    const independent = placeDetails(local, request, { reviewOnly: true });
    controller.abort();
    expect((await cancelled).available).toBe(false);
    expect((await independent).available).toBe(true);
    expect(request.mock.calls.filter(([url]) => String(url).includes('searchText'))).toHaveLength(
      2,
    );
  });
  it('reuses only verified Google place IDs, refreshes details, invalidates missing IDs', async () => {
    vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY', 'test');
    const local = { nameJa: '札幌市時計台', latitude: 43, longitude: 141 };
    let missing = false;
    const request = vi.fn(async (url: any) =>
      String(url).includes('searchText')
        ? response({
            places: [{ id: 'place-id', displayName: { text: local.nameJa }, location: local }],
          })
        : response({ id: 'place-id', rating: 4 }, missing ? 404 : 200),
    );
    await placeDetails(local, request, { reviewOnly: true });
    await placeDetails(local, request, { reviewOnly: true });
    expect(request.mock.calls.filter(([url]) => String(url).includes('searchText'))).toHaveLength(
      1,
    );
    expect(request).toHaveBeenCalledTimes(3);
    missing = true;
    await placeDetails(local, request, { reviewOnly: true });
    missing = false;
    await placeDetails(local, request, { reviewOnly: true });
    expect(request.mock.calls.filter(([url]) => String(url).includes('searchText'))).toHaveLength(
      2,
    );
  });
});
