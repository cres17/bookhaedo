import 'dotenv/config';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

// Opt-in, small paired benchmark. No production database or user data is touched.
// Only aggregate timing/status/call counts are written; no provider payloads or keys.
const root = process.cwd();
const option = (name: string, fallback = '') => {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1] || fallback;
};
type Sample = {
  scenario: string;
  arm: string;
  round: number;
  valid: boolean;
  durationMs: number;
  calls: number;
  stepsMs: number[];
  httpStatuses: Record<string, number>;
  error?: string;
};
const sourceFiles = ['providers', 'routing', 'place-details'];
const sourceHash = (source: string) => createHash('sha256').update(source).digest('hex');
const roundMs = (value: number) => Math.round(value * 100) / 100;

async function worker() {
  const arm = option('--worker');
  const round = Number(option('--round'));
  const directory = option('--baseline-dir');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let statuses: Record<string, number> = {};
  globalThis.fetch = async (input, init) => {
    calls++;
    const result = await originalFetch(input, init);
    statuses[String(result.status)] = (statuses[String(result.status)] || 0) + 1;
    return result;
  };
  const moduleUrl = (name: string) =>
    pathToFileURL(
      arm === 'before'
        ? path.join(directory, name + '.mts')
        : path.join(root, 'server', name + '.ts'),
    ).href;
  const { forecast } = await import(moduleUrl('providers'));
  const { routeSegment } = await import(moduleUrl('routing'));
  const { placeDetails } = await import(moduleUrl('place-details'));
  const { mapConcurrent } = await import('../server/provider-cache.js');
  const samples: Sample[] = [];
  async function measure(scenario: string, steps: Array<() => Promise<boolean>>) {
    calls = 0;
    statuses = {};
    const start = performance.now();
    const stepsMs: number[] = [];
    let valid = true;
    for (const step of steps) {
      const stepStart = performance.now();
      try {
        valid = await step();
      } catch {
        valid = false;
      }
      stepsMs.push(roundMs(performance.now() - stepStart));
      if (!valid) break;
    }
    const sample: Sample = {
      scenario,
      arm,
      round,
      valid,
      durationMs: roundMs(performance.now() - start),
      calls,
      stepsMs,
      httpStatuses: statuses,
      ...(!valid ? { error: 'PROVIDER_UNAVAILABLE_OR_INVALID_RESULT' } : {}),
    };
    samples.push(sample);
    process.stderr.write(
      JSON.stringify({ scenario, arm, round, valid, durationMs: sample.durationMs, calls }) + '\n',
    );
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const dates = Array.from({ length: 3 }, (_, i) =>
    new Date(Date.parse(today) + i * 86400000).toISOString().slice(0, 10),
  );
  await measure(
    'weather-three-dates',
    dates.map((date) => async () => {
      const value = await forecast(43.0625, 141.3536, date);
      return value.available === true && value.date === date && Number.isFinite(value.high);
    }),
  );
  const points = [
    { id: 'station', latitude: 43.0687, longitude: 141.3508 },
    { id: 'clock-tower', latitude: 43.0625, longitude: 141.3536 },
    { id: 'odori', latitude: 43.0599, longitude: 141.3475 },
    { id: 'susukino', latitude: 43.0553, longitude: 141.353 },
    { id: 'tv-tower', latitude: 43.0611, longitude: 141.3564 },
  ];
  await measure(
    'route-initial-repeat-edit',
    [
      [0, 1, 2, 3],
      [0, 1, 2, 3],
      [0, 4, 2, 3],
    ].map((ids) => async () => {
      const get = (id: number, index: number) =>
        routeSegment(points[ids[index]!]!, points[id]!, 'DRIVE', fetch, dates[0] + 'T00:00:00Z');
      const segments =
        arm === 'after'
          ? await mapConcurrent(ids.slice(1), 3, get)
          : await (async () => {
              const result = [];
              for (let i = 1; i < ids.length; i++) result.push(await get(ids[i]!, i - 1));
              return result;
            })();
      return (
        segments.length === 3 &&
        segments.every(
          (segment) =>
            segment.source === 'valhalla' &&
            segment.durationSeconds > 0 &&
            segment.coordinates?.length > 1,
        )
      );
    }),
  );
  const local = { nameJa: '札幌市時計台', latitude: 43.0625, longitude: 141.3536 };
  await measure(
    'place-two-visits',
    [0, 1].map(() => async () => {
      const result = await placeDetails(local);
      return result.available === true && Boolean(result.googlePlaceId);
    }),
  );
  globalThis.fetch = originalFetch;
  process.stdout.write(JSON.stringify(samples));
}

async function main() {
  if (!process.argv.includes('--live'))
    throw new Error(
      'Pass --live to allow real provider calls (including billable Google Places calls).',
    );
  const ref = option('--baseline');
  if (!/^[0-9a-f]{7,40}$/.test(ref)) throw new Error('Pass an explicit baseline commit SHA.');
  const rounds = Number(option('--rounds', '3'));
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5)
    throw new Error('Rounds must be 1..5.');
  if (process.env.NODE_ENV === 'production')
    throw new Error('Run in a local measurement environment, not inside production.');
  const baselineCommit = execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim();
  const temp = await mkdtemp(path.join(tmpdir(), 'bookhaedo-live-'));
  const fingerprints: Record<string, { before: string; after: string }> = {};
  try {
    for (const name of sourceFiles) {
      const before = execFileSync('git', ['show', `${baselineCommit}:server/${name}.ts`], {
        encoding: 'utf8',
      });
      const after = await readFile(path.join(root, 'server', name + '.ts'), 'utf8');
      fingerprints[name] = { before: sourceHash(before), after: sourceHash(after) };
      // Keep the original code; resolve its local imports outside the checkout.
      const rewritten = before.replace(/from '(\.\/[^']+)'/g, (_, relative: string) => {
        const imported = relative.slice(2).replace(/\.js$/, '');
        const file = sourceFiles.includes(imported)
          ? path.join(temp, imported + '.mts')
          : path.join(root, 'server', imported + '.ts');
        return `from '${pathToFileURL(file).href}'`;
      });
      await writeFile(path.join(temp, name + '.mts'), rewritten);
    }
    const samples: Sample[] = [];
    for (let round = 1; round <= rounds; round++) {
      for (const arm of round % 2 ? ['before', 'after'] : ['after', 'before']) {
        const values = await new Promise<Sample[]>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              '--import',
              'tsx',
              process.argv[1]!,
              '--worker',
              arm,
              '--round',
              String(round),
              '--baseline-dir',
              temp,
            ],
            { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
          );
          let output = '';
          const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('Worker timed out'));
          }, 180_000);
          child.stdout.on('data', (data) => {
            output += data;
          });
          child.stderr.on('data', (data) => {
            process.stderr.write(data);
          });
          child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error('Measurement worker failed'));
            try {
              resolve(JSON.parse(output));
            } catch {
              reject(new Error('Invalid worker report'));
            }
          });
        });
        samples.push(...values);
      }
    }
    const median = (values: number[]) => {
      const ordered = [...values].sort((a, b) => a - b);
      const middle = Math.floor(ordered.length / 2);
      return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
    };
    const comparison = [...new Set(samples.map((s) => s.scenario))].map((scenario) => {
      const before = samples.filter((s) => s.scenario === scenario && s.arm === 'before');
      const after = samples.filter((s) => s.scenario === scenario && s.arm === 'after');
      const valid = [...before, ...after].every((s) => s.valid);
      const beforeMs = median(before.map((s) => s.durationMs));
      const afterMs = median(after.map((s) => s.durationMs));
      return {
        scenario,
        valid,
        samplesPerArm: rounds,
        beforeMedianMs: roundMs(beforeMs),
        afterMedianMs: roundMs(afterMs),
        reductionPercent: valid ? roundMs((1 - afterMs / beforeMs) * 100) : null,
        beforeCalls: before.map((s) => s.calls),
        afterCalls: after.map((s) => s.calls),
      };
    });
    const report = {
      measuredAt: new Date().toISOString(),
      kind: 'local-real-provider-chain',
      productionMeasured: false,
      baselineCommit,
      fingerprints,
      method:
        'Fresh process and empty application cache per arm. Alternate arm order across rounds. Same locations and dates; real network, parsed responses, retained 1.1s Valhalla start spacing. Invalid/fallback results are not counted as speedups.',
      limitations:
        'Small sample; no production ingress, DB, auth, browser, or load. DNS/TLS/provider cache variation remains. Google photo download is excluded. Fetch call counts exclude website validation via node:http. No p95/SLA claim.',
      comparison,
      samples,
    };
    await writeFile(
      path.resolve(option('--output', 'docs/provider-live-measurement.json')),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify({ productionMeasured: false, comparison }, null, 2));
    if (comparison.some((result) => !result.valid)) process.exitCode = 1;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

try {
  if (process.argv.includes('--worker')) await worker();
  else await main();
} catch {
  console.error(
    'LIVE_BENCHMARK_FAILED: check configuration, baseline SHA, and provider connectivity. No secret details logged.',
  );
  process.exitCode = 1;
}
