import { getSelfHostedValhallaGate } from './valhalla-gate.js';
import { isPublicValhalla, PUBLIC_VALHALLA_BASE_URL } from './valhalla-policy.js';
import { setTimeout as delay } from 'node:timers/promises';
import { computeSegment } from './providers.js';
import { straightDistance } from './domain.js';
import { providerCaches, providerKey, providerSignal } from './provider-cache.js';
type Point = { id: string; latitude: number; longitude: number };
export type ValhallaSegment = Awaited<ReturnType<typeof fetchRouteSegment>>;
let queue = Promise.resolve(),
  last = 0;
async function throttle(signal?: AbortSignal) {
  const next = queue.then(async () => {
    signal?.throwIfAborted();
    await delay(Math.max(0, 1100 - (Date.now() - last)), undefined, { signal });
    last = Date.now();
  });
  queue = next.catch(() => {});
  await next;
}
export function decodeShape(shape: string) {
  let index = 0,
    lat = 0,
    lon = 0;
  const points: number[][] = [];
  function read() {
    let result = 0,
      shift = 0,
      byte;
    do {
      if (index >= shape.length || shift > 30) throw Error('BAD_SHAPE');
      byte = shape.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw Error('BAD_SHAPE');
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
  while (index < shape.length) {
    lat += read();
    lon += read();
    points.push([lon / 1e6, lat / 1e6]);
  }
  return points;
}
export async function routeSegment(
  a: Point,
  b: Point,
  mode: string,
  request: typeof fetch = fetch,
  departureTime?: string,
  signal?: AbortSignal,
) {
  if (mode === 'TRANSIT') return computeSegment(a, b, mode, request, departureTime, signal);
  const base = (process.env.VALHALLA_BASE_URL || PUBLIC_VALHALLA_BASE_URL).replace(/\/+$/, '');
  const key = providerKey(request, [
    process.env.NODE_ENV,
    base,
    a.id,
    a.latitude,
    a.longitude,
    b.id,
    b.latitude,
    b.longitude,
    mode,
    departureTime,
  ]);
  return providerCaches.valhalla.get(
    key,
    () => fetchRouteSegment(a, b, mode, request, signal, base),
    (result) => !signal?.aborted && result.source === 'valhalla',
    !signal,
  );
}

async function fetchRouteSegment(
  a: Point,
  b: Point,
  mode: string,
  request: typeof fetch,
  signal: AbortSignal | undefined,
  base: string,
) {
  const costing = (
    { DRIVE: 'auto', TAXI: 'auto', WALK: 'pedestrian', BICYCLE: 'bicycle' } as Record<
      string,
      string
    >
  )[mode];
  try {
    signal?.throwIfAborted();
    if (!costing) throw Error('BAD_MODE');
    if (process.env.NODE_ENV === 'production' && isPublicValhalla(base))
      throw Error('SELF_HOST_REQUIRED');
    if (request === fetch && isPublicValhalla(base)) await throttle(signal);
    signal?.throwIfAborted();
    const payload = {
      locations: [
        { lat: a.latitude, lon: a.longitude },
        { lat: b.latitude, lon: b.longitude },
      ],
      costing,
      units: 'kilometers',
      language: 'en-US',
    };
    const deadline = providerSignal(10000, signal);
    const readRoute = async () => {
      const response = await request(
        base + '/route?json=' + encodeURIComponent(JSON.stringify(payload)),
        { signal: deadline, headers: { 'X-Client-Id': 'bookhaedo-local-educational-poc' } },
      );
      if (!response.ok) throw Error('UNAVAILABLE');
      return response.json();
    };
    // Hold the permit until the entire body is read, not just until headers arrive.
    const body = isPublicValhalla(base)
      ? await readRoute()
      : await getSelfHostedValhallaGate().run(readRoute, deadline);
    const t = body.trip;
    if (
      t?.status !== 0 ||
      !Number.isFinite(t.summary?.length) ||
      !Number.isFinite(t.summary?.time) ||
      !t.legs?.length
    )
      throw Error('NO_ROUTE');
    const coordinates = t.legs.flatMap((l: any) => decodeShape(l.shape));
    if (coordinates.length < 2) throw Error('NO_SHAPE');
    return {
      from: a.id,
      to: b.id,
      mode,
      distanceMeters: Math.round(t.summary.length * 1000),
      durationSeconds: Math.round(t.summary.time),
      coordinates,
      polyline: null,
      source: 'valhalla',
      estimatedCost: null,
      notice: 'Valhalla / © OpenStreetMap contributors · 정체·적설·운행 시간표 미반영',
    };
  } catch {
    return {
      from: a.id,
      to: b.id,
      mode,
      distanceMeters: straightDistance(a, b),
      durationSeconds: null,
      polyline: null,
      source: 'straight-line',
      notice: '경로 조회 불가 · 직선거리만 표시하며 실제 이동시간은 알 수 없어요.',
    };
  }
}
