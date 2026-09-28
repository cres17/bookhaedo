import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';

export type LoadTestOptions = {
  url: string;
  durationSeconds: number;
  concurrency: number;
  p95LimitMs: number;
  errorRateLimit: number;
};

const percentile = (sorted: number[], value: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] || 0;

export async function runLoadTest(options: LoadTestOptions) {
  const target = new URL(options.url);
  if (
    !['127.0.0.1', 'localhost', '::1'].includes(target.hostname) &&
    process.env.ALLOW_REMOTE_LOAD_TEST !== 'true'
  )
    throw new Error('Remote load tests require ALLOW_REMOTE_LOAD_TEST=true');
  const deadline = performance.now() + options.durationSeconds * 1000;
  const latencies: number[] = [];
  let requests = 0;
  let errors = 0;
  const worker = async () => {
    while (performance.now() < deadline) {
      const started = performance.now();
      try {
        const response = await fetch(target, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) errors++;
        await response.arrayBuffer();
      } catch {
        errors++;
      } finally {
        latencies.push(performance.now() - started);
        requests++;
      }
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  latencies.sort((a, b) => a - b);
  const errorRate = requests ? errors / requests : 1;
  const report = {
    timestamp: new Date().toISOString(),
    target: `${target.origin}${target.pathname}`,
    durationSeconds: options.durationSeconds,
    concurrency: options.concurrency,
    requests,
    requestsPerSecond: Number((requests / options.durationSeconds).toFixed(1)),
    errors,
    errorRate,
    latencyMs: {
      p50: Number(percentile(latencies, 0.5).toFixed(2)),
      p95: Number(percentile(latencies, 0.95).toFixed(2)),
      p99: Number(percentile(latencies, 0.99).toFixed(2)),
      max: Number((latencies.at(-1) || 0).toFixed(2)),
    },
    thresholds: { p95Ms: options.p95LimitMs, errorRate: options.errorRateLimit },
  };
  if (report.latencyMs.p95 > options.p95LimitMs || errorRate > options.errorRateLimit)
    throw Object.assign(new Error(`Load thresholds failed: ${JSON.stringify(report)}`), { report });
  return report;
}

function argument(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

if (process.argv[1]?.endsWith('load-test.ts')) {
  const report = await runLoadTest({
    url: argument('url', 'http://127.0.0.1:3001/api/health/ready'),
    durationSeconds: Number(argument('duration', '10')),
    concurrency: Number(argument('concurrency', '20')),
    p95LimitMs: Number(argument('p95', '250')),
    errorRateLimit: Number(argument('error-rate', '0.01')),
  });
  const output = argument('output', '');
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
