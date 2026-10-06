import { expect, it, vi } from 'vitest';
import { routeMapPath } from '../frontend/src/route-map-policy';
const from = { latitude: 43, longitude: 141 },
  to = { latitude: 43.1, longitude: 141.1 };
const endpoints = [
  { lat: 43, lng: 141 },
  { lat: 43.1, lng: 141.1 },
];
it.each([
  undefined,
  [],
  [
    [141, 95],
    [141, 95.1],
  ],
  [
    [141, 43, 1],
    [141.1, 43.1],
  ],
  [
    [Infinity, 43],
    [141, 43],
  ],
  { invalid: true },
])(
  'marks absent or invalid geometry %# as an endpoint line even with routed measurements',
  (coordinates) => {
    const decode = vi.fn();
    expect(routeMapPath({ source: 'google', coordinates }, from, to, decode)).toEqual({
      path: endpoints,
      routed: false,
    });
    expect(decode).not.toHaveBeenCalled();
  },
);
it('uses valid provider coordinates as a road geometry and does not call the decoder', () => {
  const decode = vi.fn();
  expect(
    routeMapPath(
      {
        source: 'valhalla',
        coordinates: [
          [141, 43],
          [141.1, 43.1],
        ],
      },
      from,
      to,
      decode,
    ),
  ).toEqual({ path: endpoints, routed: true });
  expect(decode).not.toHaveBeenCalled();
});
it('validates Google decoded coordinates and handles SDK decode errors', () => {
  expect(
    routeMapPath({ source: 'google', polyline: 'shape' }, from, to, () => [
      [141, 43],
      [141.1, 43.1],
    ]).routed,
  ).toBe(true);
  expect(
    routeMapPath({ source: 'google', polyline: 'shape' }, from, to, () => [
      [141, 95],
      [141, 96],
    ]).routed,
  ).toBe(false);
  expect(
    routeMapPath({ source: 'google', polyline: 'shape' }, from, to, () => {
      throw Error('invalid');
    }),
  ).toEqual({ path: endpoints, routed: false });
});
it('never promotes straight-line or unavailable segments to road geometry', () => {
  for (const source of ['straight-line', 'unavailable'])
    expect(
      routeMapPath(
        {
          source,
          coordinates: [
            [141, 43],
            [141.1, 43.1],
          ],
        },
        from,
        to,
        vi.fn(),
      ).routed,
    ).toBe(false);
});
