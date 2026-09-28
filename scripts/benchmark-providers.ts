// Deterministic local workload; never contacts a paid or public provider.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mapConcurrent } from '../server/provider-cache.js';
import { routeSegment } from '../server/routing.js';
import { forecast } from '../server/providers.js';
import { placeDetails } from '../server/place-details.js';

const latencyMs = 40;
const wait = () => new Promise((resolve) => setTimeout(resolve, latencyMs));
const response = (data: unknown) => new Response(JSON.stringify(data));
type Result = {
  scenario: string;
  beforeCalls: number;
  afterCalls: number;
  beforeMs: number;
  afterMs: number;
};
const results: Result[] = [];
async function measure(scenario: string, run: (optimized: boolean) => Promise<number>) {
  const beforeStart = performance.now();
  const beforeCalls = await run(false);
  const beforeMs = performance.now() - beforeStart;
  const afterStart = performance.now();
  const afterCalls = await run(true);
  results.push({
    scenario,
    beforeCalls,
    afterCalls,
    beforeMs: Math.round(beforeMs),
    afterMs: Math.round(performance.now() - afterStart),
  });
}

await measure('3 independent startup requests', async (optimized) => {
  if (optimized) await Promise.all([wait(), wait(), wait()]);
  else for (let i = 0; i < 3; i++) await wait();
  return 3;
});
await measure('4-stop route: initial, repeated, then edit B', async (optimized) => {
  const points = ['a', 'b', 'c', 'd', 'x'].map((id, i) => ({
    id,
    latitude: 43 + i / 100,
    longitude: 141,
  }));
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    await wait();
    return response({
      trip: { status: 0, summary: { length: 1, time: 90 }, legs: [{ shape: '??_ibE_ibE' }] },
    });
  };
  for (const ids of [
    [0, 1, 2, 3],
    [0, 1, 2, 3],
    [0, 4, 2, 3],
  ]) {
    if (optimized) {
      const segments = await mapConcurrent(ids.slice(1), 3, (id, i) =>
        routeSegment(points[ids[i]!]!, points[id]!, 'DRIVE', request),
      );
      assert(segments.every((segment) => segment.source === 'valhalla'));
    } else for (let i = 1; i < ids.length; i++) await request('https://mock.invalid');
  }
  assert.equal(calls, optimized ? 5 : 9);
  return calls;
});
await measure('10 dates at the same weather location', async (optimized) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const days = Array.from({ length: 10 }, (_, i) =>
    new Date(Date.parse(today) + i * 86400000).toISOString().slice(0, 10),
  );
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    await wait();
    return response({
      daily: {
        time: days,
        temperature_2m_max: days.map(() => 20),
        temperature_2m_min: days.map(() => 10),
      },
    });
  };
  for (const date of days) {
    if (optimized) assert((await forecast(43, 141, date, request)).available);
    else await request('https://mock.invalid');
  }
  assert.equal(calls, optimized ? 1 : 10);
  return calls;
});
await measure('2 visits to the same Google place', async (optimized) => {
  process.env.GOOGLE_MAPS_SERVER_API_KEY = 'benchmark-mock-only';
  const local = { nameJa: '札幌市時計台', latitude: 43, longitude: 141 };
  let calls = 0;
  const request: typeof fetch = async (url) => {
    calls++;
    await wait();
    return response(
      String(url).includes('searchText')
        ? { places: [{ id: 'mock', displayName: { text: local.nameJa }, location: local }] }
        : { id: 'mock', rating: 4 },
    );
  };
  for (let i = 0; i < 2; i++) {
    if (optimized) assert((await placeDetails(local, request, { reviewOnly: true })).available);
    else {
      await request('https://mock.invalid/searchText');
      await request('https://mock.invalid/detail');
    }
  }
  assert.equal(calls, optimized ? 3 : 4);
  return calls;
});
console.log(
  JSON.stringify(
    {
      kind: 'synthetic',
      latencyMs,
      note: 'Mock providers only. Excludes real network, DB, browser rendering and public Valhalla rate spacing. Baseline reproduces previous sequential calls.',
      results,
    },
    null,
    2,
  ),
);
