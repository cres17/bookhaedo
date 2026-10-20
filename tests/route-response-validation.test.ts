import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { computeSegment } from '../server/providers';
import { routeSegment } from '../server/routing';
import { straightDistance } from '../server/domain';
import { MAX_ROUTE_BYTES, MAX_ROUTE_POINTS, decodeRouteShape } from '../server/route-response';

const a = { id: 'response-a', latitude: 43.0687, longitude: 141.3508 };
const b = { id: 'response-b', latitude: 43.0599, longitude: 141.3475 };
const response = (data: unknown) => new Response(JSON.stringify(data));
const google = (overrides = {}) => ({
  routes: [{ distanceMeters: 1530, duration: '360s', ...overrides }],
});
const valhalla = (summary = { length: 1.53, time: 360 }) => ({
  trip: { status: 0, summary, legs: [{ shape: '??_ibE_ibE' }] },
});
beforeEach(() => {
  vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY', 'response-validation-fixture');
  vi.stubEnv('VALHALLA_BASE_URL', 'http://127.0.0.1:8002');
});
afterEach(() => vi.unstubAllEnvs());

const unavailable = (segment: {
  source: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  notice?: string;
}) => {
  expect(segment.source).toBe('straight-line');
  expect(segment.distanceMeters).toBe(straightDistance(a, b));
  expect(segment.durationSeconds).toBeNull();
  expect(segment.notice).toContain('직선거리');
};
it.each([
  '-60s',
  '60mins',
  '60',
  '1e3s',
  '60s trailing',
  60,
  null,
  undefined,
  '1.0000000000s',
  '315576000001s',
])('does not fabricate seconds from invalid Google duration %s', async (duration) => {
  unavailable(
    await computeSegment(
      a,
      b,
      'DRIVE',
      vi.fn(async () => response(google({ duration }))),
    ),
  );
});
it.each([-1, 1.5, '1530', null, 2147483648])(
  'rejects invalid Google distance %s',
  async (distanceMeters) => {
    unavailable(
      await computeSegment(
        a,
        b,
        'DRIVE',
        vi.fn(async () => response(google({ distanceMeters }))),
      ),
    );
  },
);
it.each([
  { length: -1, time: 90 },
  { length: 1, time: -90 },
  { length: 1e308, time: 90 },
  { length: 1, time: 1e308 },
  { length: 1, time: null },
])('rejects negative or unrepresentable Valhalla summary %j', async (summary) => {
  unavailable(
    await routeSegment(
      a,
      b,
      'WALK',
      vi.fn(async () => response(valhalla(summary as { length: number; time: number }))),
    ),
  );
});
it.each([
  ['0s', 0],
  ['360.25s', 360.25],
  ['0.000000001s', 0.000000001],
] as const)('preserves valid Google duration %s', async (duration, durationSeconds) => {
  expect(
    await computeSegment(
      a,
      b,
      'DRIVE',
      vi.fn(async () => response(google({ duration }))),
    ),
  ).toMatchObject({
    source: 'google',
    distanceMeters: 1530,
    durationSeconds,
  });
});
it('accepts a real zero-distance/zero-time Valhalla response', async () => {
  expect(
    await routeSegment(
      a,
      b,
      'WALK',
      vi.fn(async () => response(valhalla({ length: 0, time: 0 }))),
    ),
  ).toMatchObject({
    source: 'valhalla',
    distanceMeters: 0,
    durationSeconds: 0,
  });
});
it.each(['google', 'valhalla'] as const)(
  'recovers from malformed %s responses while preserving its cache policy',
  async (provider) => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () =>
        response(
          provider === 'google'
            ? google({ duration: '360minutes' })
            : valhalla({ length: -1, time: 360 }),
        ),
      )
      .mockImplementation(async () => response(provider === 'google' ? google() : valhalla()));
    const call = () =>
      provider === 'google'
        ? computeSegment(a, b, 'DRIVE', fetch)
        : routeSegment(a, b, 'WALK', fetch);
    unavailable(await call());
    expect((await call()).source).toBe(provider);
    expect((await call()).source).toBe(provider);
    // Google Routes intentionally has no completed-result cache; Valhalla reuses valid results.
    expect(fetch).toHaveBeenCalledTimes(provider === 'google' ? 3 : 2);
  },
);

const encode = (points: number[][], precision: number) => {
  let lat = 0,
    lon = 0,
    value = '';
  const component = (n: number) => {
    let x = n < 0 ? ~(n << 1) : n << 1;
    let result = '';
    while (x >= 32) {
      result += String.fromCharCode((32 | (x & 31)) + 63);
      x >>= 5;
    }
    return result + String.fromCharCode(x + 63);
  };
  for (const [longitude, latitude] of points) {
    const a = Math.round(latitude * precision),
      b = Math.round(longitude * precision);
    value += component(a - lat) + component(b - lon);
    lat = a;
    lon = b;
  }
  return value;
};
it.each(['valhalla', 'google'] as const)(
  'rejects out-of-range %s geometry before caching and recovers',
  async (provider) => {
    const shape = (valid: boolean) =>
      encode(
        [
          [141, valid ? 43 : 95],
          [141.001, valid ? 43.001 : 95.001],
        ],
        provider === 'google' ? 1e5 : 1e6,
      );
    const body = (valid: boolean) =>
      provider === 'google'
        ? google({ polyline: { encodedPolyline: shape(valid) } })
        : {
            trip: { status: 0, summary: { length: 1, time: 30 }, legs: [{ shape: shape(valid) }] },
          };
    const transport = vi
      .fn()
      .mockImplementationOnce(async () => response(body(false)))
      .mockImplementation(async () => response(body(true)));
    const call = () =>
      provider === 'google'
        ? computeSegment(a, b, 'DRIVE', transport)
        : routeSegment(a, b, 'WALK', transport);
    unavailable(await call());
    expect((await call()).source).toBe(provider);
    expect((await call()).source).toBe(provider);
    expect(transport).toHaveBeenCalledTimes(provider === 'google' ? 3 : 2);
  },
);
it.each([{ invalid: true }, 123, [], false, '_', '~~~~~~~', '?'.repeat(300000)])(
  'rejects malformed Google polyline case %#',
  async (encodedPolyline) => {
    unavailable(
      await computeSegment(
        a,
        b,
        'DRIVE',
        vi.fn(async () => response(google({ polyline: { encodedPolyline } }))),
      ),
    );
  },
);
it.each([undefined, null, ''])(
  'preserves routed measurements when Google geometry is absent %s',
  async (encodedPolyline) => {
    expect(
      await computeSegment(
        a,
        b,
        'DRIVE',
        vi.fn(async () => response(google({ polyline: { encodedPolyline } }))),
      ),
    ).toMatchObject({ source: 'google', polyline: null, durationSeconds: 360 });
  },
);

it('enforces response bytes even when content length is missing', async () => {
  const transport = vi.fn(async () => new Response(' '.repeat(MAX_ROUTE_BYTES + 1)));
  unavailable(await routeSegment(a, b, 'WALK', transport));
  expect(transport).toHaveBeenCalledTimes(1);
});
it('enforces total point count and accepts valid coordinate boundaries', () => {
  expect(
    decodeRouteShape(
      encode(
        [
          [-180, -90],
          [180, 90],
        ],
        1e6,
      ),
    ),
  ).toEqual([
    [-180, -90],
    [180, 90],
  ]);
  expect(() => decodeRouteShape('??'.repeat(MAX_ROUTE_POINTS + 1))).toThrow();
  expect(() =>
    decodeRouteShape(
      encode(
        [
          [181, 0],
          [181, 1],
        ],
        1e6,
      ),
    ),
  ).toThrow();
});

it('does not let an unresponsive body cancellation delay size-limit rejection', async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_ROUTE_BYTES + 1));
      },
      cancel() {
        return new Promise(() => {});
      },
    }),
  );
  const { readRouteJson } = await import('../server/route-response');
  await expect(readRouteJson(response)).rejects.toThrow('ROUTE_TOO_LARGE');
});
