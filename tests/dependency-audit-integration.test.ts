import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditDependencies, classifyAudit, runAudit } from '../scripts/audit-dependencies.mjs';
let root: string;
const cli = process.env.AUDIT_TEST_NPM_CLI || process.env.npm_execpath;
let calls: string[] = [];
const captures: any[] = [];
beforeAll(async () => {
  expect(cli, 'Tests must execute a real npm CLI').toBeTruthy();
  root = await mkdtemp(join(tmpdir(), 'bookhaedo-audit-contract-'));
  await writeFile(join(root, 'empty-npmrc'), '');
  await writeFile(join(root, 'global-npmrc'), '');
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'audit-contract-test',
      version: '1.0.0',
      dependencies: { 'audit-fixture': '1.0.0' },
    }),
  );
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({
      name: 'audit-contract-test',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'audit-contract-test',
          version: '1.0.0',
          dependencies: { 'audit-fixture': '1.0.0' },
        },
        'node_modules/audit-fixture': { version: '1.0.0' },
      },
    }),
  );
});
afterAll(async () => {
  if (process.env.AUDIT_CAPTURE_PATH)
    await writeFile(process.env.AUDIT_CAPTURE_PATH, JSON.stringify(captures, null, 2));
  if (root) await rm(root, { recursive: true, force: true });
});
async function runNpm(registry: string, timeoutMs = 8000, fetchTimeoutMs = 1500) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^npm_config_/i.test(k)),
  );
  const env = {
    ...inherited,
    npm_config_registry: registry,
    npm_config_fetch_retries: '0',
    npm_config_fetch_timeout: String(fetchTimeoutMs),
    npm_config_userconfig: join(root, 'empty-npmrc'),
    npm_config_globalconfig: join(root, 'global-npmrc'),
    npm_config_cache: join(root, `cache-${captures.length}`),
  };
  const result = await runAudit({ cwd: root, env, npmCli: cli, timeoutMs });
  captures.push(result);
  return result;
}
async function registry(response: (path: string) => { status: number; body: unknown }) {
  calls = [];
  const server = createServer((req, res) => {
    calls.push(req.url!);
    req.resume();
    const result = response(req.url!);
    res.writeHead(result.status, { 'content-type': 'application/json', connection: 'close' });
    res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No registry port');
  return { server, url: `http://127.0.0.1:${address.port}` };
}
const close = (server: Server) =>
  new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
it.each([400, 429, 503])(
  'retries real npm HTTP %i output and requires a subsequent successful audit',
  async (status) => {
    let attempt = 0;
    const local = await registry(() =>
      attempt === 1
        ? {
            status,
            body: {
              statusCode: status,
              error: 'Bad Request',
              message:
                status === 400
                  ? 'Invalid package tree, run npm install to rebuild your package-lock.json'
                  : 'registry unavailable',
            },
          }
        : { status: 200, body: {} },
    );
    try {
      const states: string[] = [];
      const exit = await auditDependencies({
        run: async () => {
          attempt++;
          const result = await runNpm(local.url);
          states.push(classifyAudit(result));
          return result;
        },
        sleep: async () => {},
        log: () => {},
      });
      expect(states).toEqual(['retry', 'pass']);
      expect(exit).toBe(0);
      expect(calls.some((p) => p.endsWith('/advisories/bulk'))).toBe(true);
    } finally {
      await close(local.server);
    }
  },
);
it('fails after three actual unavailable-registry attempts', async () => {
  let attempts = 0;
  const local = await registry(() => ({ status: 503, body: { message: 'unavailable' } }));
  try {
    expect(
      await auditDependencies({
        run: () => {
          attempts++;
          return runNpm(local.url);
        },
        sleep: async () => {},
        log: () => {},
      }),
    ).toBe(1);
    expect(attempts).toBe(3);
  } finally {
    await close(local.server);
  }
});
it('recognizes connection refusal from real npm JSON rather than a fabricated error.code', async () => {
  const local = await registry(() => ({ status: 200, body: {} }));
  await close(local.server);
  expect(classifyAudit(await runNpm(local.url))).toBe('retry');
});
it.each([400, 401, 403])('does not retry permanent npm HTTP %i errors', async (status) => {
  const local = await registry(() => ({ status, body: { message: 'denied' } }));
  try {
    expect(classifyAudit(await runNpm(local.url))).toBe('fail');
  } finally {
    await close(local.server);
  }
});
it('fails closed when real npm receives malformed successful responses', async () => {
  const local = await registry(() => ({ status: 200, body: 'not JSON' }));
  try {
    expect(classifyAudit(await runNpm(local.url))).toBe('fail');
  } finally {
    await close(local.server);
  }
});
it.each(['high', 'critical'])('never retries a real npm %s advisory report', async (severity) => {
  const local = await registry((path) =>
    path.endsWith('/advisories/bulk')
      ? {
          status: 200,
          body: {
            'audit-fixture': [
              {
                id: 123456,
                url: 'https://example.test/advisory',
                title: `Synthetic ${severity} advisory`,
                severity,
                vulnerable_versions: '<=1.0.0',
                cwe: ['CWE-400'],
                cvss: { score: 7.5, vectorString: null },
              },
            ],
          },
        }
      : {
          status: 200,
          body: {
            name: 'audit-fixture',
            'dist-tags': { latest: '1.0.0' },
            versions: { '1.0.0': { name: 'audit-fixture', version: '1.0.0' } },
          },
        },
  );
  try {
    let attempts = 0;
    const result = await runNpm(local.url);
    expect(JSON.parse(result.stdout).metadata.vulnerabilities[severity]).toBeGreaterThan(0);
    expect(classifyAudit(result)).toBe('vulnerable');
    expect(
      await auditDependencies({
        run: () => {
          attempts++;
          return result;
        },
        sleep: async () => {},
        log: () => {},
      }),
    ).toBe(1);
    expect(attempts).toBe(1);
  } finally {
    await close(local.server);
  }
});

it('bounds the real npm child process when a registry connection hangs', async () => {
  let received = false;
  const server = createServer((req) => {
    received = true;
    req.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No registry port');
  try {
    // npm's own network timeout must outlast the wrapper's process deadline.
    const result = await runNpm(`http://127.0.0.1:${address.port}`, 2000, 10000);
    expect(received, 'The npm process must reach the hanging registry').toBe(true);
    expect(result.status).toBeNull();
    expect(result.error?.code).toBe('ETIMEDOUT');
    expect(classifyAudit(result)).toBe('retry');
  } finally {
    server.closeAllConnections();
    await close(server);
  }
});
