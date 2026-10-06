import { MAX_ROUTE_POINTS, MAX_SHAPE_CHARS } from '../shared/route-shape-policy.js';
export { MAX_ROUTE_POINTS, MAX_SHAPE_CHARS } from '../shared/route-shape-policy.js';
import { z } from 'zod';
// Safety caps, not measured capacity targets. No endpoint snap-distance assumption.
export const MAX_ROUTE_BYTES = 2 * 1024 * 1024;
export async function readRouteJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const length = response.headers.get('content-length');
  if (length && Number(length) > MAX_ROUTE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw Error('ROUTE_TOO_LARGE');
  }
  if (!response.body) throw Error('EMPTY_ROUTE');
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '',
    bytes = 0,
    completed = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) {
        completed = true;
        break;
      }
      bytes += part.value.byteLength;
      if (bytes > MAX_ROUTE_BYTES) {
        throw Error('ROUTE_TOO_LARGE');
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!completed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function decodeRouteShape(shape: string, precision = 1e6): number[][] {
  if (typeof shape !== 'string' || shape.length > MAX_SHAPE_CHARS) throw Error('INVALID_SHAPE');
  let index = 0,
    latitude = 0,
    longitude = 0;
  const points: number[][] = [];
  const component = () => {
    let n = 0,
      shift = 0;
    while (true) {
      if (index >= shape.length || shift > 30) throw Error('INVALID_SHAPE');
      const byte = shape.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw Error('INVALID_SHAPE');
      n += (byte & 31) * 2 ** shift;
      if (n > 0xffffffff) throw Error('INVALID_SHAPE');
      if (byte < 32) return n % 2 ? -(Math.floor(n / 2) + 1) : n / 2;
      shift += 5;
    }
  };
  while (index < shape.length) {
    latitude += component();
    longitude += component();
    const lat = latitude / precision,
      lon = longitude / precision;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      points.length >= MAX_ROUTE_POINTS
    )
      throw Error('INVALID_SHAPE');
    points.push([lon, lat]);
  }
  if (points.length < 2) throw Error('NO_SHAPE');
  return points;
}
const measurement = z.number().finite().nonnegative();
const valhalla = z.object({
  trip: z.object({
    status: z.literal(0),
    summary: z.object({ length: measurement, time: measurement }),
    legs: z
      .array(z.object({ shape: z.string().max(MAX_SHAPE_CHARS) }))
      .min(1)
      .max(64),
  }),
});
export function parseValhallaRoute(body: unknown) {
  const { trip } = valhalla.parse(body);
  const coordinates: number[][] = [];
  for (const leg of trip.legs) {
    const points = decodeRouteShape(leg.shape);
    if (coordinates.length + points.length > MAX_ROUTE_POINTS) throw Error('ROUTE_TOO_MANY_POINTS');
    coordinates.push(...points);
  }
  return { summary: trip.summary, coordinates };
}
const google = z.object({
  routes: z
    .array(
      z.object({
        distanceMeters: z.number().int().min(0).max(2147483647),
        duration: z.string().regex(/^\d+(?:\.\d{1,9})?s$/),
        polyline: z
          .object({ encodedPolyline: z.string().max(MAX_SHAPE_CHARS).nullable().optional() })
          .nullable()
          .optional(),
        localizedValues: z
          .object({ transitFare: z.object({ text: z.string() }).optional() })
          .optional(),
        travelAdvisory: z
          .object({ transitFare: z.unknown().optional(), tollInfo: z.unknown().optional() })
          .optional(),
      }),
    )
    .min(1),
});
export function parseGoogleRoute(body: unknown) {
  const route = google.parse(body).routes[0]!;
  const durationSeconds = Number(route.duration.slice(0, -1));
  if (!Number.isFinite(durationSeconds) || durationSeconds > 315576000000)
    throw Error('BAD_DURATION');
  const polyline = route.polyline?.encodedPolyline || null;
  if (polyline) decodeRouteShape(polyline, 1e5);
  return { route, durationSeconds, polyline };
}
