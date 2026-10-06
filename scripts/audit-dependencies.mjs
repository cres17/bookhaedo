import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND']);
const retryStatuses = new Set([429, 500, 502, 503, 504]);
export function classifyAudit(result) {
  let report;
  try {
    report = JSON.parse(result.stdout ?? '');
  } catch {
    /* Missing/malformed output never passes. */
  }
  if (!object(report)) return result.error?.code === 'ETIMEDOUT' ? 'retry' : 'fail';
  const counts = report.metadata?.vulnerabilities;
  // A security finding takes priority over any accompanying transport error.
  if (object(counts) && (counts.high > 0 || counts.critical > 0)) return 'vulnerable';
  if (
    object(report.vulnerabilities) &&
    Object.values(report.vulnerabilities).some(
      (v) => object(v) && ['high', 'critical'].includes(v.severity),
    )
  )
    return 'vulnerable';
  if ('auditReportVersion' in report || 'metadata' in report || 'vulnerabilities' in report) {
    const levels = ['info', 'low', 'moderate', 'high', 'critical'];
    const validCounts =
      object(counts) &&
      [...levels, 'total'].every((k) => Number.isSafeInteger(counts[k]) && counts[k] >= 0) &&
      levels.reduce((n, k) => n + counts[k], 0) === counts.total;
    const validFindings =
      object(report.vulnerabilities) &&
      Object.values(report.vulnerabilities).every(
        (v) => object(v) && levels.includes(v.severity),
      ) &&
      validCounts &&
      levels.every(
        (level) =>
          Object.values(report.vulnerabilities).filter((v) => v.severity === level).length ===
          counts[level],
      );
    return report.auditReportVersion === 2 &&
      validCounts &&
      validFindings &&
      result.status === 0 &&
      !result.signal &&
      !result.error &&
      !report.error
      ? 'pass'
      : 'fail';
  }
  if (!object(report.error)) return 'fail';
  // npm 10/11 serialize registry HTTP errors at the top level, not in error.code.
  const status = report.statusCode;
  if (Number.isInteger(status)) {
    if (retryStatuses.has(status)) return 'retry';
    return status === 400 &&
      object(report.body) &&
      typeof report.body.message === 'string' &&
      /Invalid package tree/.test(report.body.message)
      ? 'retry'
      : 'fail';
  }
  const code = report.error.code ?? result.error?.code;
  if (networkCodes.has(code) || /^E(?:429|500|502|503|504)$/.test(code ?? '')) return 'retry';
  if (code === 'E400' && /Invalid package tree/.test(report.error.summary ?? '')) return 'retry';
  // Actual npm network errors put the system code in the top-level message.
  return typeof report.message === 'string' &&
    /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b/.test(report.message)
    ? 'retry'
    : 'fail';
}
export function runAudit({
  cwd = process.cwd(),
  env = process.env,
  npmCli = env.npm_execpath,
  timeoutMs = 60000,
} = {}) {
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [...(npmCli ? [npmCli] : []), 'audit', '--omit=dev', '--audit-level=high', '--json'];
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd,
        env,
        encoding: 'utf8',
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 8_000_000,
      },
      (error, stdout, stderr) =>
        resolve({
          status: error ? (typeof error.code === 'number' ? error.code : null) : 0,
          signal: error?.signal,
          stdout,
          stderr,
          error:
            error && typeof error.code !== 'number'
              ? { code: error.killed && error.signal === 'SIGKILL' ? 'ETIMEDOUT' : error.code }
              : undefined,
        }),
    );
  });
}
export async function auditDependencies({
  run = runAudit,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
} = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let result;
    try {
      result = await run();
    } catch {
      log('Dependency audit: process execution failed');
      return 1;
    }
    const state = classifyAudit(result);
    log(`Dependency audit ${attempt}/3: ${state}`);
    // Project only audit fields, even if an error and a finding arrive together.
    if (state === 'pass' || state === 'vulnerable') {
      const report = JSON.parse(result.stdout);
      const counts = Object.fromEntries(
        ['info', 'low', 'moderate', 'high', 'critical', 'total']
          .filter((k) => Number.isSafeInteger(report.metadata?.vulnerabilities?.[k]))
          .map((k) => [k, report.metadata.vulnerabilities[k]]),
      );
      const findings = object(report.vulnerabilities)
        ? Object.fromEntries(
            Object.entries(report.vulnerabilities)
              .filter(([, v]) => object(v) && typeof v.severity === 'string')
              .map(([name, v]) => [name, { severity: v.severity, fixAvailable: !!v.fixAvailable }]),
          )
        : {};
      log(JSON.stringify({ vulnerabilities: findings, metadata: { vulnerabilities: counts } }));
    }
    if (state === 'pass') return 0;
    if (state !== 'retry' || attempt === 3) return 1;
    await sleep(2000 * attempt);
  }
  return 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await auditDependencies();
