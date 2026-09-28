import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect, type Page, type BrowserContext, type Response } from '@playwright/test';
import pg from 'pg';

const root = process.cwd();
const option = (key: string, fallback = '') => {
  const i = process.argv.indexOf(key);
  return i < 0 ? fallback : process.argv[i + 1] || fallback;
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const rounded = (value: number) => Math.round(value * 100) / 100;
const port = 39731;
const baseURL = `http://127.0.0.1:${port}`;
const script = path.resolve(process.argv[1]!);
const source = (ref: string, file: string) =>
  execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' });

async function server() {
  const snapshot = option('--server');
  // Minified production frontend with the real Express/DB app. Test-mode server
  // allows local HTTP/public demo routing and namespaces rate limits by PID.
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.APP_ORIGINS, baseURL);
  const nativeFetch = globalThis.fetch;
  const calls: Record<string, number> = {};
  const statuses: Record<string, number> = {};
  globalThis.fetch = async (input, init) => {
    const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
    const provider = host.includes('open-meteo')
      ? 'weather'
      : host.includes('googleapis')
        ? 'google'
        : 'routing';
    calls[provider] = (calls[provider] || 0) + 1;
    const response = await nativeFetch(input, init);
    const label = provider + ':' + response.status;
    statuses[label] = (statuses[label] || 0) + 1;
    return response;
  };
  const { app } = await import(pathToFileURL(path.join(snapshot, 'server/app.ts')).href);
  const { verifyMigrations, pool } = await import(
    pathToFileURL(path.join(snapshot, 'server/db.ts')).href
  );
  const { default: express } = await import('express');
  await verifyMigrations();
  app.use(express.static(path.join(snapshot, 'dist')));
  app.get('/{*path}', (_req: unknown, res: any) =>
    res.sendFile(path.join(snapshot, 'dist/index.html')),
  );
  const listener = app.listen(port, '127.0.0.1', () => process.send?.({ type: 'ready' }));
  listener.on('error', () => {
    process.send?.({ type: 'failed' });
    process.exitCode = 1;
  });
  process.on('message', (message: any) => {
    if (message.type === 'stats') process.send?.({ type: 'stats', calls, statuses });
  });
  process.on('SIGTERM', () =>
    listener.close(async () => {
      await pool.end();
      process.exit(0);
    }),
  );
}

async function run(command: string, args: string[], cwd: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('BUILD_FAILED'))));
  });
}
async function start(snapshot: string) {
  return new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, '--server', snapshot], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'test', APP_ORIGINS: baseURL, HTTP_LOG_SAMPLE_RATE: '0' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('SERVER_START_TIMEOUT'));
    }, 20_000);
    child.on('error', reject);
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('SERVER_START_FAILED'));
    });
    child.on('message', (message: any) => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        resolve(child);
      }
      if (message.type === 'failed') {
        clearTimeout(timer);
        child.kill();
        reject(new Error('SERVER_START_FAILED'));
      }
    });
  });
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
async function stats(child: ChildProcess) {
  return new Promise<any>((resolve, reject) => {
    const handler = (message: any) => {
      if (message.type === 'stats') {
        clearTimeout(timer);
        child.off('message', handler);
        resolve(message);
      }
    };
    const timer = setTimeout(() => {
      child.off('message', handler);
      reject(new Error('STATS_TIMEOUT'));
    }, 3000);
    child.on('message', handler);
    child.send({ type: 'stats' });
  });
}
async function painted(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}
async function browserElapsed(page: Page, epochStart?: number) {
  return rounded(
    await page.evaluate(
      (start) =>
        start === undefined
          ? performance.now()
          : performance.timeOrigin + performance.now() - start,
      epochStart,
    ),
  );
}

async function main() {
  assert(process.argv.includes('--live'), 'LIVE_OPT_IN_REQUIRED');
  const rounds = Number(option('--rounds', '3'));
  assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 5, 'INVALID_ROUNDS');
  const ref = option('--baseline', '71bca6f');
  assert(/^[a-f0-9]{7,40}$/.test(ref), 'INVALID_BASELINE');
  const commit = execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim();
  const connectionString =
    process.env.DATABASE_URL || 'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan';
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname),
    'LOCAL_DB_REQUIRED',
  );
  const output = path.join(root, 'output/browser-benchmark');
  await mkdir(output, { recursive: true });
  const temp = await mkdtemp(path.join(tmpdir(), 'bookhaedo-browser-'));
  const db = new pg.Pool({ connectionString });
  const uid = randomUUID(),
    tid = randomUUID(),
    did = randomUUID();
  const email = `browser-benchmark-${uid}@example.test`,
    password = randomUUID() + '-Aa1';
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const fingerprints: Record<string, any> = {};
  const samples: any[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let child: ChildProcess | undefined;
  try {
    const restore = [
      'frontend/src/store.ts',
      'server/providers.ts',
      'server/routing.ts',
      'server/place-details.ts',
    ];
    for (const arm of ['before', 'after']) {
      const snapshot = path.join(temp, arm);
      await mkdir(snapshot);
      for (const directory of ['frontend', 'server', 'shared', 'db'])
        await cp(path.join(root, directory), path.join(snapshot, directory), { recursive: true });
      for (const file of ['package.json', 'vite.config.ts'])
        await cp(path.join(root, file), path.join(snapshot, file));
      await symlink(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), 'dir');
      if (arm === 'before') {
        for (const file of restore) {
          const previous = source(commit, file),
            current = await readFile(path.join(root, file), 'utf8');
          fingerprints[file] = {
            before: sha(previous),
            after: sha(current),
            reconstruction: 'original committed file',
          };
          await writeFile(path.join(snapshot, file), previous);
        }
        // These route modules were uncommitted before optimization. Restore the
        // observed sequential dispatch while keeping all authorization/UI intact.
        for (const file of ['server/routes/providers.ts', 'server/day-alternatives.ts']) {
          const current = await readFile(path.join(snapshot, file), 'utf8');
          assert(current.includes('import { mapConcurrent }'), 'BASELINE_PATCH_NO_LONGER_APPLIES');
          const previous = current.replace(
            'import { mapConcurrent }',
            'import { mapSequential as mapConcurrent }',
          );
          await writeFile(path.join(snapshot, file), previous);
          fingerprints[file] = {
            before: sha(previous),
            after: sha(current),
            reconstruction:
              'sequential dispatch reconstructed from pre-change code shown in task history',
          };
        }
        await writeFile(
          path.join(snapshot, 'server/provider-cache.ts'),
          (await readFile(path.join(snapshot, 'server/provider-cache.ts'), 'utf8')) +
            '\nexport async function mapSequential<T,R>(items: readonly T[], _concurrency: number, work: (item:T,index:number)=>Promise<R>):Promise<R[]> { const values:R[]=[]; for(let i=0;i<items.length;i++) values.push(await work(items[i]!,i)); return values; }\n',
        );
      }
      await run(
        process.execPath,
        [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'],
        snapshot,
      );
      console.log(JSON.stringify({ event: 'production-assets-built', arm }));
    }
    const { passwordHash } = await import('../server/auth/password.js');
    const places = (
      await db.query(
        `SELECT id,COALESCE(name_ko,name_ja) AS name,latitude,longitude FROM geo_data.place WHERE region_id='sapporo' AND category='ATTRACTION' AND latitude BETWEEN 43.055 AND 43.075 AND longitude BETWEEN 141.34 AND 141.36 ORDER BY (name_ja='札幌市時計台') DESC, (osm_tags ? 'wikidata') DESC, id LIMIT 4`,
      )
    ).rows;
    assert.equal(places.length, 4, 'NEED_FOUR_CATALOG_PLACES');
    await db.query(
      'INSERT INTO planner.app_user(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
      [uid, email, '성능 측정 전용', await passwordHash(password)],
    );
    await db.query(
      'INSERT INTO planner.trip(id,user_id,title,transport_mode) VALUES($1,$2,$3,$4)',
      [tid, uid, '성능 비교용 삿포로 일정', 'DRIVE'],
    );
    await db.query('INSERT INTO planner.trip_day(id,trip_id,visit_date) VALUES($1,$2,$3)', [
      did,
      tid,
      today,
    ]);
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.platform === 'darwin'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : undefined,
    });
    for (let round = 1; round <= rounds; round++)
      for (const arm of round % 2 ? ['before', 'after'] : ['after', 'before']) {
        await db.query('DELETE FROM planner.itinerary_item WHERE day_id=$1', [did]);
        for (let i = 0; i < places.length; i++)
          await db.query(
            'INSERT INTO planner.itinerary_item(id,day_id,place_id,position) VALUES($1,$2,$3,$4)',
            [randomUUID(), did, places[i].id, i],
          );
        await db.query('UPDATE planner.trip_day SET revision=0 WHERE id=$1', [did]);
        child = await start(path.join(temp, arm));
        const context: BrowserContext = await browser.newContext({
          baseURL,
          viewport: { width: 1440, height: 960 },
        });
        const page: Page = await context.newPage();
        page.setDefaultTimeout(30_000);
        const errors: string[] = [];
        const requests: any[] = [];
        page.on('pageerror', () => errors.push('BROWSER_PAGE_ERROR'));
        page.on('requestfinished', (req) => {
          const url = new URL(req.url());
          if (url.origin !== baseURL || !url.pathname.startsWith('/api/')) return;
          const timing = req.timing();
          requests.push({
            path: url.pathname
              .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id')
              .replace(/\d{4}-\d{2}-\d{2}/g, ':date'),
            method: req.method(),
            durationMs: rounded(timing.responseEnd),
            scenario: activeScenario,
          });
        });
        let activeScenario = 'login-page';
        const timings: Record<string, number> = {};
        async function readyRoutes(responsePromise: ReturnType<Page['waitForResponse']>) {
          const response = await responsePromise;
          assert.equal(response.status(), 200, 'ROUTE_HTTP_FAILED');
          const data = await response.json();
          assert.equal(data.segments.length, 3, 'ROUTE_SEGMENT_COUNT');
          assert(
            data.segments.every((s: any) => s.source === 'valhalla' && s.durationSeconds !== null),
            'ROUTE_FALLBACK_NOT_A_VALID_TIMING',
          );
          await expect(page.locator('.route-between')).toHaveCount(3);
          for (const item of await page.locator('.route-between').all())
            await expect(item).toContainText('Valhalla');
          await expect(page.locator('.weather-chip')).toContainText('Open-Meteo');
          await expect(page.locator('.map-loading')).toHaveCount(0);
          await expect(page.locator('.map-fallback')).toHaveCount(0);
          await expect(page.locator('.google-canvas .gm-style')).toBeVisible();
          await expect(page.locator('.page-enter-active,.page-leave-active')).toHaveCount(0);
          await painted(page);
        }
        try {
          await page.goto(`${baseURL}/login?redirect=/trips/${tid}`);
          await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
          await expect(page.locator('.page-enter-active,.page-leave-active')).toHaveCount(0);
          await painted(page);
          timings.loginPage = await browserElapsed(page);
          await page.getByLabel('이메일', { exact: true }).fill(email);
          await page.getByLabel('비밀번호', { exact: true }).fill(password);
          activeScenario = 'login-and-first-trip';
          const firstRoutes = page.waitForResponse((r) =>
            r.url().includes(`/days/${today}/routes`),
          );
          const login: Promise<Response> = page.waitForResponse((r) =>
            r.url().endsWith('/api/auth/login'),
          );
          await page.getByRole('button', { name: '로그인', exact: true }).click();
          const loginResult = await login;
          assert.equal(loginResult.status(), 200, 'LOGIN_FAILED');
          await loginResult.finished();
          const loginTiming = loginResult.request().timing();
          timings.loginResponse = rounded(loginTiming.responseEnd);
          await expect(page.locator('.itinerary-stop')).toHaveCount(4);
          await painted(page);
          timings.firstTripBasic = await browserElapsed(page, loginTiming.startTime);
          await readyRoutes(firstRoutes);
          timings.firstTripComplete = await browserElapsed(page, loginTiming.startTime);
          activeScenario = 'trip-reload';
          const reloadRoutes = page.waitForResponse((r) =>
            r.url().includes(`/days/${today}/routes`),
          );
          await page.reload();
          await readyRoutes(reloadRoutes);
          timings.repeatTripComplete = await browserElapsed(page);
          activeScenario = 'reorder-and-render';
          const changeRoutes = page.waitForResponse((r) =>
            r.url().includes(`/days/${today}/routes`),
          );
          const saved = page.waitForResponse(
            (r) => r.request().method() === 'PUT' && r.url().includes('/items'),
          );
          await page
            .getByRole('button', { name: /위로 이동/ })
            .nth(1)
            .click();
          const savedResponse = await saved;
          assert.equal(savedResponse.status(), 200, 'SAVE_FAILED');
          await expect(page.locator('.stop-name').first()).toHaveText(places[1].name);
          await readyRoutes(changeRoutes);
          timings.reorderComplete = await browserElapsed(
            page,
            savedResponse.request().timing().startTime,
          );
          const stored = (
            await db.query(
              'SELECT place_id FROM planner.itinerary_item WHERE day_id=$1 ORDER BY position',
              [did],
            )
          ).rows.map((r) => r.place_id);
          assert.deepEqual(
            stored,
            [places[1].id, places[0].id, places[2].id, places[3].id],
            'DB_ORDER_NOT_SAVED',
          );
          assert.deepEqual(errors, [], 'BROWSER_ERRORS');
          const providerStats = await stats(child);
          samples.push({
            round,
            arm,
            valid: true,
            timings,
            requests,
            providerStats,
            databaseOrderVerified: true,
          });
          if (round === 1)
            await page.screenshot({
              path: path.join(output, arm + '-planner.png'),
              fullPage: true,
            });
          console.log(
            JSON.stringify({ event: 'measured', round, arm, timings, calls: providerStats.calls }),
          );
        } catch (error) {
          await page
            .screenshot({ path: path.join(output, `${arm}-${round}-failed.png`), fullPage: true })
            .catch(() => {});
          samples.push({
            round,
            arm,
            valid: false,
            timings,
            requests,
            error: error instanceof Error ? error.message.split('\n')[0] : 'UNKNOWN',
          });
          await writeFile(path.join(output, 'partial.json'), JSON.stringify(samples, null, 2));
          throw error;
        } finally {
          await context.close();
          await stop(child);
          child = undefined;
        }
      }
    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const n = sorted.length;
      return n % 2 ? sorted[Math.floor(n / 2)]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
    };
    const comparison = Object.keys(samples[0].timings).map((metric) => {
      const before = samples.filter((s) => s.arm === 'before').map((s) => s.timings[metric]);
      const after = samples.filter((s) => s.arm === 'after').map((s) => s.timings[metric]);
      const b = median(before),
        a = median(after);
      return {
        metric,
        beforeMedianMs: rounded(b),
        afterMedianMs: rounded(a),
        reductionPercent: rounded((1 - a / b) * 100),
        beforeRangeMs: [Math.min(...before), Math.max(...before)],
        afterRangeMs: [Math.min(...after), Math.max(...after)],
      };
    });
    const report = {
      measuredAt: new Date().toISOString(),
      kind: 'local-production-assets-browser-real-db-and-providers',
      productionInfrastructureMeasured: false,
      historicalPrechangeMeasurementAvailable: false,
      baselineCommit: commit,
      reconstruction:
        'Same current UI/auth/DB. Restore four original committed files; reconstruct sequential route dispatch in two previously uncommitted modules. This is a remeasured counterfactual baseline, not a historical deployment snapshot.',
      environment: {
        frontend: 'vite production build, served by Express static; no Vite dev server',
        backend:
          'NODE_ENV=test for local HTTP, public Valhalla routing and per-process rate-limit namespaces; production guard/security/cookie configuration not simulated',
        browser: await browser.version(),
        viewport: '1440x960',
        rounds,
        topology:
          'single local process per arm, same local PostgreSQL catalog/account/trip, fresh browser context and process per arm',
      },
      method:
        'Alternate order by round. Real login, session authorization, DB reads/write+verification, real Google map tiles, weather and Valhalla. Wait for route/weather/map DOM, loaded fonts and two animation frames. Browser navigationStart for loginPage/reload; actual login HTTP request start for firstTrip; actual PUT HTTP request start for reorder. loginResponse uses browser HTTP responseEnd. Excludes automation pre-click waiting, but readiness detection polling overhead remains. No mocked HTTP or synthetic delays.',
      limitations:
        'Small sample. No cloud/ingress/mobile/network throttling/concurrent users. Database and OS/network caches not flushed. Later navigation includes browser HTTP cache. No p95 claim. Google auth/map failure invalidates sample.',
      fingerprints,
      comparison,
      samples,
    };
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ event: 'complete', comparison }, null, 2));
  } finally {
    if (child) await stop(child);
    await browser?.close();
    try {
      await db.query('DELETE FROM planner.app_user WHERE id=$1 AND email=$2', [uid, email]);
      const remaining = await db.query('SELECT id FROM planner.app_user WHERE id=$1', [uid]);
      assert.equal(remaining.rowCount, 0, 'TEST_ACCOUNT_CLEANUP_FAILED');
      await writeFile(
        path.join(output, 'cleanup.json'),
        JSON.stringify(
          {
            accountRemoved: true,
            temporaryServersStopped: true,
            checkedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } finally {
      await db.end();
      await rm(temp, { recursive: true, force: true });
    }
  }
}

try {
  if (process.argv.includes('--server')) await server();
  else await main();
} catch (error) {
  console.error(
    'BROWSER_BENCHMARK_FAILED',
    error instanceof Error ? error.message.split('\n')[0] : 'UNKNOWN',
  );
  process.exitCode = 1;
}
