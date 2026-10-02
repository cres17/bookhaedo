import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function classifyAudit(result) {
  let report;
  try {
    report = JSON.parse(result.stdout ?? '');
  } catch {
    /* A process timeout can have no JSON. */
  }
  const counts = report?.metadata?.vulnerabilities;
  if (
    report?.auditReportVersion === 2 &&
    Number.isInteger(counts?.high) &&
    counts.high >= 0 &&
    Number.isInteger(counts?.critical) &&
    counts.critical >= 0
  ) {
    if (counts.high || counts.critical) return 'vulnerable';
    return result.status === 0 && !result.error && !report.error ? 'pass' : 'fail';
  }
  const code = report?.error?.code ?? result.error?.code;
  const transient = new Set([
    'E429',
    'E500',
    'E502',
    'E503',
    'E504',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
  ]);
  if (transient.has(code)) return 'retry';
  // The retired quick-audit endpoint also reported this server error for our unchanged lockfile.
  if (code === 'E400' && /Invalid package tree/.test(JSON.stringify(report?.error))) return 'retry';
  return 'fail';
}
export async function auditDependencies({
  run = () =>
    spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['audit', '--omit=dev', '--audit-level=high', '--json'],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 8_000_000 },
    ),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
} = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = run();
    const state = classifyAudit(result);
    log(`Dependency audit ${attempt}/3: ${state}`);
    if (result.stdout) log(result.stdout);
    if (state === 'pass') return 0;
    if (state !== 'retry' || attempt === 3) {
      if (result.stderr) log(result.stderr);
      if (result.error) log(`Audit process error: ${result.error.code ?? 'unknown'}`);
      return 1;
    }
    await sleep(2000 * attempt);
  }
  return 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await auditDependencies();
