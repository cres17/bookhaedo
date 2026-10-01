import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pool } from '../../server/db.js';
import { routeSegment } from '../../server/routing.js';
const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    label: { type: 'string' },
    fixture: { type: 'boolean', default: false },
  },
});
const originalFetch = globalThis.fetch;
const originalBase = process.env.VALHALLA_BASE_URL;
const server = values.fixture
  ? createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            trip: { status: 0, summary: { length: 1, time: 90 }, legs: [{ shape: '??_ibE_ibE' }] },
          }),
        );
      }, 30);
    })
  : null;
try {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Fixture listener unavailable');
    process.env.VALHALLA_BASE_URL = `http://127.0.0.1:${address.port}`;
  }
  const endpoint = new URL(process.env.VALHALLA_BASE_URL || 'https://valhalla1.openstreetmap.de');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
    throw Error('This benchmark only runs against an explicitly configured loopback Valhalla.');
  const fixture = JSON.parse(
    await readFile(
      new URL('../../docs/research/tourism-data-ingestion-20261001.json', import.meta.url),
      'utf8',
    ),
  );
  const ids: string[] = fixture.realUi[0].previewPlaceIds;
  const points = (
    await pool.query(
      'SELECT id,latitude,longitude FROM geo_data.place WHERE id=ANY($1::text[]) ORDER BY array_position($1::text[],id)',
      [ids],
    )
  ).rows;
  if (points.length !== 4) throw Error('Recorded four-place course is missing from the catalog');
  let calls = 0,
    active = 0,
    peak = 0;
  const starts: number[] = [];
  globalThis.fetch = async (url, options) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    starts.push(performance.now());
    try {
      return await originalFetch(url, options);
    } finally {
      active--;
    }
  };
  const key = 'routing-benchmark-' + crypto.randomUUID();
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: 2 }, () =>
      Promise.all(
        points
          .slice(1)
          .map((b, i) =>
            routeSegment(points[i], b, 'WALK', undefined, key, AbortSignal.timeout(10000)),
          ),
      ),
    ),
  );
  const report = {
    measuredAt: new Date().toISOString(),
    label: values.label,
    backend: values.fixture
      ? 'Loopback HTTP fixture with 30ms response delay and synthetic route values'
      : 'Configured loopback Valhalla',
    scope:
      'Two concurrent three-segment previews using the recorded four-place course, with per-caller cancellation signals and cold route cache keys; loopback Valhalla only',
    points,
    callers: 2,
    segmentsPerCaller: 3,
    requests: calls,
    peakRequests: peak,
    elapsedMs: performance.now() - started,
    requestStartOffsetsMs: starts.map((t) => t - started),
    results: results.map((segments) => ({
      complete: segments.every(
        (s) => s.source === 'valhalla' && Number.isFinite(s.durationSeconds),
      ),
      sources: segments.map((s) => s.source),
      distanceMeters: segments.map((s) => s.distanceMeters),
      durationSeconds: segments.map((s) => s.durationSeconds),
    })),
    limits: [
      'Single local six-request run, not a production throughput or queue saturation test',
      'Signalled calls remain independent in flight; completed cache reuse is unchanged',
      'No weather or API/UI flow is exercised by this benchmark',
    ],
  };
  if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      label: report.label,
      requests: report.requests,
      peakRequests: report.peakRequests,
      elapsedMs: report.elapsedMs,
      complete: report.results.map((r) => r.complete),
    }),
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalBase === undefined) delete process.env.VALHALLA_BASE_URL;
  else process.env.VALHALLA_BASE_URL = originalBase;
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await pool.end();
}
