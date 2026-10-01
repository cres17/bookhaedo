// Local self-hosted Valhalla only. Benchmark accounts are removed; catalog/snapshots stay intact.
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import request from 'supertest';
import { pool } from '../../server/db.js';
import { createSession } from '../../server/auth/session.js';
const { values } = parseArgs({
  options: {
    users: { type: 'string', default: '1,5,10,25' },
    rounds: { type: 'string', default: '3' },
    count: { type: 'string', default: '4' },
    output: { type: 'string' },
    label: { type: 'string', default: 'baseline' },
    date: { type: 'string', default: '2026-11-01' },
  },
});
const levels = values.users!.split(',').map(Number),
  rounds = Number(values.rounds),
  count = Number(values.count);
if (
  !levels.length ||
  levels.some((n) => !Number.isInteger(n) || n < 1 || n > 50) ||
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 10 ||
  ![4, 6].includes(count)
)
  throw Error('Invalid benchmark size');
const endpoint = new URL(process.env.VALHALLA_BASE_URL || 'https://valhalla1.openstreetmap.de');
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
  endpoint.username ||
  endpoint.password
)
  throw Error('Explicit loopback Valhalla required; public/remote endpoints refused');
const offset =
  (Date.parse(values.date!) -
    Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }))) /
  86400000;
if (!Number.isFinite(offset) || (offset >= 0 && offset <= 9))
  throw Error('Use an out-of-forecast date so no weather provider is contacted');
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
const { app } = await import('../../server/app.js');
const { PostgresRateLimitStore } = await import('../../server/http/rate-limit.js');
const quota = new PostgresRateLimitStore(pool, `ai-recommendation-test-${process.pid}`, 60000);
const fixture = JSON.parse(
  await readFile(
    new URL('../../docs/research/tourism-data-ingestion-20261001.json', import.meta.url),
    'utf8',
  ),
);
const ids: string[] = fixture.realUi[0].previewPlaceIds;
if (
  ids.length !== 4 ||
  (await pool.query('SELECT id FROM geo_data.place WHERE id=ANY($1::text[])', [ids])).rowCount !== 4
)
  throw Error('Recorded four-place course not present');
const originalFetch = globalThis.fetch;
const accounts: { userId: string; tripId: string; cookie: string }[] = [];
const measured: any[] = [];
const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * p) - 1)] ?? null;
try {
  const ready = await originalFetch(endpoint.origin + '/status');
  if (!ready.ok) throw Error('Valhalla not ready');
  const valhalla = await ready.json();
  for (let i = 0; i < Math.max(...levels); i++) {
    const userId = randomUUID(),
      tripId = randomUUID(),
      dayId = randomUUID();
    accounts.push({ userId, tripId, cookie: '' });
    await pool.query(
      'INSERT INTO planner.app_user(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
      [
        userId,
        `tourism-load-${userId}@example.test`,
        'Local load benchmark',
        'disabled-benchmark-login',
      ],
    );
    const token = await createSession(pool, userId);
    accounts.at(-1)!.cookie = 'kita_session=' + token;
    await pool.query(
      "INSERT INTO planner.trip(id,user_id,title,transport_mode) VALUES($1,$2,'Local recommendation load','WALK')",
      [tripId, userId],
    );
    await pool.query('INSERT INTO planner.trip_day(id,trip_id,visit_date) VALUES($1,$2,$3)', [
      dayId,
      tripId,
      values.date,
    ]);
    for (const [position, id] of ids.entries())
      await pool.query(
        'INSERT INTO planner.itinerary_item(id,day_id,place_id,position) VALUES($1,$2,$3,$4)',
        [randomUUID(), dayId, id, position],
      );
  }
  for (const users of levels)
    for (let round = 0; round < rounds; round++)
      for (const operation of ['recommendation', 'preview']) {
        let external = 0,
          active = 0,
          peak = 0;
        const networkDurations: number[] = [];
        // A fresh transport identity gives cold cache keys; the next batch uses these same keys warm.
        globalThis.fetch = async (url, init) => {
          if (new URL(String(url)).origin !== endpoint.origin)
            throw Error('Unexpected external provider request');
          external++;
          active++;
          peak = Math.max(peak, active);
          const start = performance.now();
          try {
            const response = await originalFetch(url, init);
            const bytes = await response.arrayBuffer();
            return new Response(bytes, { status: response.status, headers: response.headers });
          } finally {
            active--;
            networkDurations.push(performance.now() - start);
          }
        };
        for (const cache of ['cold', 'warm']) {
          for (const a of accounts.slice(0, users)) await quota.resetKey(a.userId);
          external = 0;
          peak = 0;
          networkDurations.length = 0;
          const start = performance.now();
          const responses = await Promise.all(
            accounts.slice(0, users).map(async (a) => {
              const begin = performance.now();
              const r = await request(app)
                .post(`/api/trips/${a.tripId}/days/${values.date}/ai-recommendations`)
                .set('Cookie', a.cookie)
                .send({
                  count,
                  keepPlaceIds: ids,
                  ...(operation === 'preview' ? { strategy: 'NEARBY' } : {}),
                });
              return {
                elapsedMs: performance.now() - begin,
                status: r.status,
                recommendationStatus: r.body.status,
                weatherAvailable: r.body.weather?.available,
                complete: r.body.preview?.complete ?? null,
                segments: r.body.preview?.segments?.map((s: any) => s.source) ?? [],
                planIds: r.body.preview?.plan?.places?.map((p: any) => p.id) ?? [],
              };
            }),
          );
          if (active !== 0) throw Error('Requests still running after response batch');
          const durations = responses.map((r) => r.elapsedMs),
            segments = responses.flatMap((r) => r.segments);
          const row = {
            users,
            round: round + 1,
            operation,
            cache,
            count,
            elapsedMs: performance.now() - start,
            p50Ms: percentile(durations, 0.5),
            p95Ms: percentile(durations, 0.95),
            maxMs: Math.max(...durations),
            httpErrors: responses.filter((r) => r.status !== 200).length,
            incompletePreviews: responses.filter((r) => r.complete === false).length,
            externalRequests: external,
            peakExternalRequests: peak,
            segments: segments.length,
            unavailableSegments: segments.filter((s) => s !== 'valhalla').length,
            providerP95Ms: percentile(networkDurations, 0.95),
            responses,
          };
          measured.push(row);
          console.log(
            JSON.stringify({
              label: values.label,
              users,
              round: round + 1,
              operation,
              cache,
              p95Ms: row.p95Ms,
              externalRequests: external,
              peakExternalRequests: peak,
              incompletePreviews: row.incompletePreviews,
              httpErrors: row.httpErrors,
            }),
          );
        }
      }
  const a = accounts[0];
  await quota.resetKey(a.userId);
  const rateResponses = [];
  for (let i = 0; i < 40; i++)
    rateResponses.push(
      (
        await request(app)
          .post(`/api/trips/${a.tripId}/days/${values.date}/ai-recommendations`)
          .set('Cookie', a.cookie)
          .send({ count, keepPlaceIds: ids })
      ).status,
    );
  const report = {
    measuredAt: new Date().toISOString(),
    label: values.label,
    valhalla,
    date: values.date,
    count,
    levels,
    rounds,
    anchorPlaceIds: ids,
    routeLimit: process.env.VALHALLA_MAX_CONCURRENT ?? 'unbounded before limit implementation',
    routeQueue: process.env.VALHALLA_MAX_QUEUE ?? 'unbounded',
    routingSourceHash: createHash('sha256')
      .update(await readFile(new URL('../../server/routing.ts', import.meta.url)))
      .digest('hex'),
    measured,
    rateLimitCheck: { requests: 40, statuses: rateResponses },
    limits: [
      'Local ARM64 container with actual Hokkaido OSM routes; not the deployed production host.',
      'No external weather: out-of-forecast date; complete real API authentication, permission, database retrieval, LangGraph and routing.',
      'Benchmark-only accounts inserted without usable passwords, authenticated through real session validation.',
      'Each independent trial resets only its own test accounts recommendation quota; the separate forty-call run checks the actual rate limit.',
      'Fresh fetch identity controls application cache misses; Valhalla tiles are already built and its internal caches are not reset.',
    ],
  };
  if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
} finally {
  globalThis.fetch = originalFetch;
  for (const a of accounts) await quota.resetKey(a.userId);
  await pool.query('DELETE FROM planner.app_user WHERE id=ANY($1::uuid[])', [
    accounts.map((a) => a.userId),
  ]);
  await pool.end();
}
