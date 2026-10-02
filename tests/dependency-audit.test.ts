import { expect, it, vi } from 'vitest';
import { auditDependencies, classifyAudit } from '../scripts/audit-dependencies.mjs';
const report = (high = 0, critical = 0) => ({
  status: high || critical ? 1 : 0,
  stdout: JSON.stringify({
    auditReportVersion: 2,
    metadata: { vulnerabilities: { high, critical, moderate: 1 } },
  }),
});
const error = (code: string, summary = 'registry unavailable') => ({
  status: 1,
  stdout: JSON.stringify({ error: { code, summary } }),
});
const execute = (results: unknown[]) => {
  const run = vi.fn();
  results.forEach((r) => run.mockReturnValueOnce(r));
  const sleep = vi.fn(async () => {});
  const log = vi.fn();
  return { run, sleep, log };
};
it('passes a valid report below the existing high threshold', async () => {
  const deps = execute([report()]);
  expect(await auditDependencies(deps)).toBe(0);
  expect(deps.run).toHaveBeenCalledTimes(1);
});
it.each([report(1), report(0, 1)])(
  'never retries a reported high or critical vulnerability',
  async (result) => {
    const deps = execute([result, report()]);
    expect(await auditDependencies(deps)).toBe(1);
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  },
);
it.each([
  'E429',
  'E500',
  'E502',
  'E503',
  'E504',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
])('retries a transient %s then checks the actual successful report', async (code) => {
  const deps = execute([error(code), report()]);
  expect(await auditDependencies(deps)).toBe(0);
  expect(deps.run).toHaveBeenCalledTimes(2);
  expect(deps.sleep).toHaveBeenCalledWith(2000);
});
it('retries the exact retired endpoint error but stops after three failed attempts', async () => {
  const failure = error(
    'E400',
    'Invalid package tree, run npm install to rebuild your package-lock.json',
  );
  const deps = execute([failure, failure, failure]);
  expect(await auditDependencies(deps)).toBe(1);
  expect(deps.run).toHaveBeenCalledTimes(3);
  expect(deps.sleep.mock.calls).toEqual([[2000], [4000]]);
});
it('fails immediately if a retry returns actual vulnerabilities', async () => {
  const deps = execute([error('E503'), report(1), report()]);
  expect(await auditDependencies(deps)).toBe(1);
  expect(deps.run).toHaveBeenCalledTimes(2);
});
it.each([
  { status: 0, stdout: 'not JSON' },
  { status: 0, stdout: '{}' },
  {
    status: 1,
    stdout: JSON.stringify({
      auditReportVersion: 2,
      metadata: { vulnerabilities: { high: 0, critical: 0 } },
    }),
  },
  error('E401'),
  error('E403'),
  error('E400', 'bad local configuration'),
  {
    status: 0,
    stdout: JSON.stringify({
      auditReportVersion: 2,
      metadata: { vulnerabilities: { high: '0', critical: 0 } },
    }),
  },
])(
  'fails closed for malformed output, permanent errors or unexpected exit status',
  async (result) => {
    const deps = execute([result, report()]);
    expect(await auditDependencies(deps)).toBe(1);
    expect(deps.run).toHaveBeenCalledTimes(1);
  },
);
it('handles a timed-out child process without treating missing output as success', async () => {
  expect(classifyAudit({ status: null, error: { code: 'ETIMEDOUT' }, stdout: '' })).toBe('retry');
  const deps = execute(Array(3).fill({ status: null, error: { code: 'ETIMEDOUT' }, stdout: '' }));
  expect(await auditDependencies(deps)).toBe(1);
});
