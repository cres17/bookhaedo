import { afterEach, expect, it, vi } from 'vitest';
import { validateProduction } from '../server/config';
import { routeSegment } from '../server/routing';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const body = {
  trip: { status: 0, summary: { length: 1, time: 90 }, legs: [{ shape: '??_ibE_ibE' }] },
};
const point = (id: string, latitude = 43) => ({ id, latitude, longitude: 141 });

it('dispatches self-hosted signalled calls concurrently without the public global gate', async () => {
  vi.stubEnv('VALHALLA_BASE_URL', 'http://127.0.0.1:8002');
  const controllers = Array.from({ length: 3 }, () => new AbortController());
  const releases: (() => void)[] = [];
  const fetch = vi.fn(
    (_url: any, init: any) =>
      new Promise<Response>((resolve, reject) => {
        releases.push(() => resolve(new Response(JSON.stringify(body))));
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      }),
  );
  vi.stubGlobal('fetch', fetch);
  // Same cache key, independent caller signals: changing the gate must not change coalescing policy.
  const calls = controllers.map((controller) =>
    routeSegment(point('self-a'), point('self-b'), 'WALK', undefined, undefined, controller.signal),
  );
  try {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3), { timeout: 500 });
    releases.forEach((release) => release());
    expect((await Promise.all(calls)).every((segment) => segment.source === 'valhalla')).toBe(true);
    await routeSegment(
      point('self-a'),
      point('self-b'),
      'WALK',
      undefined,
      undefined,
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    controllers.forEach((controller) => controller.abort());
    await Promise.allSettled(calls);
  }
});

it.each(['', 'https://valhalla1.openstreetmap.de', 'https://VALHALLA1.OPENSTREETMAP.DE./'])(
  'keeps spacing for the public demo even when explicitly configured: %s',
  async (base) => {
    vi.stubEnv('VALHALLA_BASE_URL', base);
    const starts: number[] = [];
    const fetch = vi.fn(async () => {
      starts.push(performance.now());
      return new Response(JSON.stringify(body));
    });
    vi.stubGlobal('fetch', fetch);
    const segments = await Promise.all(
      [0, 1, 2].map((i) => routeSegment(point('public-' + base + i), point('public-end'), 'WALK')),
    );
    expect(segments.every((segment) => segment.source === 'valhalla')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
  },
);

it('cancels a queued public caller without starting its HTTP request or blocking later callers', async () => {
  vi.stubEnv('VALHALLA_BASE_URL', '');
  const fetch = vi.fn(async () => new Response(JSON.stringify(body)));
  vi.stubGlobal('fetch', fetch);
  await routeSegment(point('queue-prime'), point('queue-end'), 'WALK');
  const controller = new AbortController();
  const cancelled = routeSegment(
    point('queue-cancel'),
    point('queue-end'),
    'WALK',
    undefined,
    undefined,
    controller.signal,
  );
  const next = routeSegment(point('queue-next'), point('queue-end'), 'WALK');
  controller.abort();
  expect((await cancelled).durationSeconds).toBeNull();
  expect((await next).source).toBe('valhalla');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('rejects public URL aliases at production startup and before route HTTP work', async () => {
  const base = 'https://VALHALLA1.OPENSTREETMAP.DE./';
  expect(() =>
    validateProduction({
      NODE_ENV: 'production',
      DATABASE_URL: 'test-only',
      METRICS_TOKEN: 'm'.repeat(32),
      APP_ORIGINS: 'https://example.test',
      VALHALLA_BASE_URL: base,
    }),
  ).toThrow('self-hosted');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VALHALLA_BASE_URL', base);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const segment = await routeSegment(point('production-public'), point('production-end'), 'WALK');
  expect(segment).toMatchObject({ source: 'straight-line', durationSeconds: null });
  expect(fetch).not.toHaveBeenCalled();
});
