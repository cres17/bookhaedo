import { expect, it, vi } from 'vitest';
import { auditDependencies, classifyAudit } from '../scripts/audit-dependencies.mjs';
const report = (high = 0, critical = 0) => ({
  status: high || critical ? 1 : 0,
  stdout: JSON.stringify({
    auditReportVersion: 2,
    metadata: {
      vulnerabilities: { info: 0, low: 0, high, critical, moderate: 1, total: high + critical + 1 },
    },
    vulnerabilities: { fixture: { severity: 'moderate' } },
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

it('classifies captured real npm 10.9.9 reports instead of relying solely on constructed JSON', async () => {
  const { readFileSync } = await import('node:fs');
  const cases = JSON.parse(
    readFileSync(new URL('./fixtures/npm-audit/npm-10.9.9.json', import.meta.url), 'utf8'),
  ).cases;
  for (const fixture of cases)
    expect(classifyAudit({ status: fixture.status, stdout: JSON.stringify(fixture.report) })).toBe(
      fixture.expected,
    );
});
it.each([
  null,
  [],
  'text',
  {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 1 } },
  },
])('rejects malformed report shape or inconsistent totals: %j', (value) => {
  expect(classifyAudit({ status: 0, stdout: JSON.stringify(value) })).toBe('fail');
});
it('security findings win over a misleading HTTP retry status', () => {
  expect(
    classifyAudit({
      status: 1,
      stdout: JSON.stringify({
        statusCode: 503,
        error: {},
        vulnerabilities: { fixture: { severity: 'critical' } },
      }),
    }),
  ).toBe('vulnerable');
});
it('does not leak registry headers or URLs from an error payload', async () => {
  const deps = execute([
    {
      status: 1,
      stdout: JSON.stringify({
        statusCode: 401,
        error: {},
        uri: 'https://secret@registry.test',
        headers: { authorization: 'private-fixture' },
      }),
    },
  ]);
  expect(await auditDependencies(deps)).toBe(1);
  expect(JSON.stringify(deps.log.mock.calls)).not.toMatch(/private-fixture|secret@/);
});
it('fails closed if the audit process cannot be started', async () => {
  expect(
    await auditDependencies({
      run: async () => {
        throw Error('spawn unavailable');
      },
      sleep: async () => {},
      log: () => {},
    }),
  ).toBe(1);
});

it('rejects a report whose vulnerability map contradicts its zero counts', () => {
  expect(
    classifyAudit({
      status: 0,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: { fixture: { severity: 'moderate' } },
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
        },
      }),
    }),
  ).toBe('fail');
});

it('fails a mixed vulnerability/error report without logging transport credentials', async () => {
  const deps = execute([
    {
      status: 1,
      stdout: JSON.stringify({
        statusCode: 503,
        error: {},
        uri: 'https://private-user@registry.test',
        headers: { authorization: 'private-transport-fixture' },
        vulnerabilities: { fixture: { severity: 'critical', fixAvailable: true } },
      }),
    },
  ]);
  expect(await auditDependencies(deps)).toBe(1);
  expect(deps.run).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(deps.log.mock.calls)).not.toMatch(
    /private-transport-fixture|private-user@/,
  );
});
