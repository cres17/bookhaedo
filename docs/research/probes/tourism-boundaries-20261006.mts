// Diagnostic snapshot of ver2@9e29e46; assertions reproduce existing defects, not desired behavior.
// Not part of CI. After a fix, a failing assertion here may mean the defect was repaired.
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
if (!root) throw Error('Pass checkout absolute path');
const imp = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const { createTourismGraph, formatTourismResult } = await imp('server/ai/tourism-graph.ts');
const { buildDayPlans } = await imp('server/day-alternatives.ts');
const { forecast } = await imp('server/providers.ts');
const { observeRequests, renderMetrics, resetMetricsForTest } = await imp(
  'server/observability/metrics.ts',
);
const { pool } = await imp('server/db.ts');
const place = (id: string, n = 1, extra = {}) => ({
  id,
  name: id,
  nameJa: id,
  regionId: 'sapporo',
  category: 'ATTRACTION',
  latitude: 43.06 + n / 10000,
  longitude: 141.35,
  tags: { tourism: 'museum' },
  ...extra,
});
const old = place('old', 0);
const candidates = [place('a'), place('b', 2), place('c', 3)];
const evidence = (p: any) => ({
  id: `src:${p.id}`,
  snapshotId: 'snapshot',
  sourceId: 'src',
  externalId: p.id,
  placeId: p.id,
  kind: 'place',
  title: p.name,
  excerpt: 'fixture',
  dateStatus: 'unknown',
});
const input = {
  requestId: 'probe',
  userId: 'fixture-user',
  tripId: 'fixture-trip',
  dayId: 'fixture-day',
  date: '2026-10-10',
  revision: 0,
  items: [old],
  regionId: 'sapporo',
  transportMode: 'WALK',
  count: 3,
  keepPlaceIds: [],
  interests: '',
};
const deps = (extra = {}) => ({
  search: async () => ({
    candidates,
    evidence: [evidence(candidates[0])],
    snapshotIds: ['snapshot'],
  }),
  weather: async () => ({ available: false }),
  route: async (a: any, b: any) => ({
    from: a.id,
    to: b.id,
    source: 'valhalla',
    distanceMeters: 1000,
    durationSeconds: 1800,
  }),
  ...extra,
});
const findings: any[] = [];
try {
  const closed = place('closed', 1, { openingHours: 'closed' });
  const plain = buildDayPlans([closed, ...candidates], [old], { available: false }, 3);
  const graph = await createTourismGraph(
    deps({
      search: async () => ({ candidates: [closed, ...candidates], evidence: [], snapshotIds: [] }),
    }),
  ).invoke({ input });
  assert(plain.find((p: any) => p.id === 'NEARBY').places.some((p: any) => p.id === 'closed'));
  assert(!graph.plans.some((p: any) => p.places.some((q: any) => q.id === 'closed')));
  findings.push({ id: 'R1', closedPlaceInLegacyNearby: true, closedPlaceInGraph: false });

  const dupA = place('osm-node', 1, { name: '同一施設', nameJa: '同一施設' }),
    dupB = { ...dupA, id: 'osm-way' };
  const ds = await createTourismGraph(
    deps({
      search: async () => ({
        candidates: [dupA, dupB, ...candidates],
        evidence: [evidence(dupA)],
        snapshotIds: ['snapshot'],
      }),
    }),
  ).invoke({ input });
  const knowledge = ds.plans.find((p: any) => p.id === 'KNOWLEDGE').places.map((p: any) => p.id);
  const nearby = ds.plans.find((p: any) => p.id === 'NEARBY').places.map((p: any) => p.id);
  assert(knowledge.includes('osm-node') && knowledge.includes('osm-way'));
  assert(!(nearby.includes('osm-node') && nearby.includes('osm-way')));
  findings.push({ id: 'R2', knowledge, nearby });

  const departures: any[] = [];
  const transit = await createTourismGraph(
    deps({
      route: async (a: any, b: any, mode: any, _f: any, departure: any) => {
        departures.push({ from: a.id, to: b.id, mode, departure });
        return {
          from: a.id,
          to: b.id,
          source: 'google',
          distanceMeters: 1000,
          durationSeconds: 1800,
        };
      },
    }),
  ).invoke({ input: { ...input, transportMode: 'TRANSIT', strategy: 'KNOWLEDGE' } });
  assert.equal(new Set(departures.map((d) => d.departure)).size, 1);
  assert.equal(transit.preview.complete, true);
  findings.push({
    id: 'R3',
    departures,
    complete: transit.preview.complete,
    totalSeconds: transit.preview.durationSeconds,
  });

  const start = performance.now();
  let searchArguments = 0;
  await createTourismGraph(
    deps({
      timeoutMs: 10,
      search: async (...args: any[]) => {
        searchArguments = args.length;
        await delay(80);
        return { candidates, evidence: [], snapshotIds: [] };
      },
    }),
  ).invoke({ input });
  const elapsed = performance.now() - start;
  assert(elapsed >= 70);
  findings.push({
    id: 'D1',
    providerTimeoutMs: 10,
    searchDelayMs: 80,
    elapsedMs: Math.round(elapsed),
    searchArguments,
  });

  let revoked = false,
    searches = 0;
  const stale = await createTourismGraph(
    deps({
      search: async () => {
        searches++;
        return {
          candidates,
          evidence: revoked ? [] : [evidence(candidates[0])],
          snapshotIds: ['snapshot'],
        };
      },
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
    }),
  ).invoke({ input: { ...input, strategy: 'KNOWLEDGE' } });
  const formatted = formatTourismResult(input, stale);
  assert(revoked && formatted.evidence.length === 1 && searches === 1);
  findings.push({
    id: 'D2',
    injectedWithdrawalDuringRoute: revoked,
    searches,
    returnedEvidence: formatted.evidence.map((e: any) => e.id),
    scope: 'controlled dependency; no DB withdrawal performed',
  });

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  let weatherCalls = 0;
  const malformed = async () => {
    weatherCalls++;
    return new Response(
      JSON.stringify({
        daily: {
          time: Array.from({ length: 10 }, (_, i) =>
            new Date(Date.parse(today) + i * 86400000).toISOString().slice(0, 10),
          ),
          temperature_2m_max: Array(10).fill(5),
          temperature_2m_min: Array(10).fill(30),
          weather_code: Array(10).fill(0),
          precipitation_probability_max: Array(10).fill(999),
          wind_speed_10m_max: Array(10).fill(-10),
        },
      }),
    );
  };
  const weather = await forecast(43.06, 141.35, today, malformed);
  await forecast(43.06, 141.35, today, malformed);
  assert(
    weather.available &&
      weather.high < weather.low &&
      weather.precipitationProbability === 999 &&
      weatherCalls === 1,
  );
  findings.push({
    id: 'R5',
    weather: {
      available: weather.available,
      high: weather.high,
      low: weather.low,
      precipitationProbability: weather.precipitationProbability,
      windSpeedKmh: weather.windSpeedKmh,
    },
    transportCallsForTwoReads: weatherCalls,
    scope: 'malformed fixture; not observed real Open-Meteo response',
  });

  resetMetricsForTest();
  let resolveEntered!: () => void, resolveClosed!: () => void;
  const entered = new Promise<void>((r) => (resolveEntered = r)),
    closedResponse = new Promise<void>((r) => (resolveClosed = r));
  const server = createServer((req: any, res: any) => {
    res.locals = {};
    observeRequests(req, res, () => {
      resolveEntered();
      res.once('close', resolveClosed);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as any;
  const client = get(`http://127.0.0.1:${addr.port}/api/probe`);
  client.on('error', () => {});
  await entered;
  client.destroy();
  await closedResponse;
  server.close();
  await once(server, 'close');
  const inflight = Number(renderMetrics().match(/bookhaedo_http_requests_in_flight (\d+)/)![1]);
  assert.equal(inflight, 1);
  findings.push({
    id: 'R4',
    actualOpenRequests: 0,
    inflightGauge: inflight,
    scope: 'real loopback HTTP client disconnect',
  });
  resetMetricsForTest();
  console.log(JSON.stringify({ baseline: '9e29e46', findings }, null, 2));
} finally {
  await pool.end();
}
