// Probe: a "현재 일정 확인" GET that succeeds AFTER the user switched to another day.
// Question under test: is the fetched snapshot applied to the parent, or silently dropped while the recovery marker is cleared?
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
test('late recovery check after day switch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const email = randomUUID() + '@example.test';
  const ids = Array.from({ length: 5 }, () => randomUUID());
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
  });
  let trip = '';
  let fault: 'after' | 'none' = 'none';
  let holdCheck = false;
  let releaseCheck: (() => void) | undefined;
  const log: Record<string, unknown> = {};
  try {
    for (const [i, id] of ids.entries())
      await db.query(
        `INSERT INTO geo_data.place(id,region_id,category,name_ja,name_ko,normalized_name,latitude,longitude,location,region_distance_km,osm_tags) VALUES($1,'sapporo','ATTRACTION',$2,$2,$1,$3,141.35,ST_SetSRID(ST_MakePoint(141.35,$3),4326)::geography,0,'{"tourism":"museum"}')`,
        [id, '복구 시설 ' + i, 43.06 + i * 0.001],
      );
    expect((await page.request.post('/api/auth/register', { data: { email, name: 'probe', password: 'recovery-password' } })).status()).toBe(201);
    const created = await page.request.post('/api/trips', { data: { title: '늦은 확인 프로브', startDate: '2026-10-10', days: 2, transportMode: 'WALK' } });
    trip = (await created.json()).data.id;
    for (const d of ['2026-10-10', '2026-10-11'])
      expect((await page.request.put(`/api/trips/${trip}/days/${d}/items`, { data: { placeIds: ids.slice(0, 2), expectedRevision: 0 } })).status()).toBe(200);
    const places = (await db.query(`SELECT id,name_ko AS name,name_ja AS "nameJa",category,region_id AS "regionId",latitude,longitude,osm_tags AS tags FROM geo_data.place WHERE id=ANY($1::text[]) ORDER BY array_position($1::text[],id)`, [ids])).rows;
    const plan = { id: 'NEARBY', label: '프로브 코스', reason: '검증', places: places.slice(2), distanceMeters: 2000 };
    await page.route('https://maps.googleapis.com/**', (r) => r.abort());
    await page.route('**/api/weather?*', (r) => r.fulfill({ json: { available: false } }));
    await page.route('**/routes', (r) => r.fulfill({ json: { segments: [] } }));
    await page.route('**/day-alternatives*', async (r) => {
      if (r.request().method() === 'PATCH') {
        if (fault === 'after') {
          expect((await r.fetch()).status()).toBe(200); // server commits, client never sees the response
          return r.abort('failed');
        }
        return r.continue();
      }
      const current = (await (await page.request.get('/api/trips/' + trip)).json()).data;
      const url = new URL(r.request().url());
      const date = url.pathname.split('/days/')[1]!.split('/')[0]!;
      const day = current.days.find((d: any) => d.date === date);
      const selected = url.searchParams.get('strategy');
      return r.fulfill({
        json: {
          tripId: trip, date, transportMode: current.transportMode, expectedRevision: day.revision,
          expectedPlaceIds: day.items.map((p: any) => p.id), weather: { available: false }, plans: [plan],
          preview: selected ? { plan, segments: [], complete: true, mode: current.transportMode, distanceMeters: 2000, durationSeconds: 600 } : null,
        },
      });
    });
    // Hold only the trip snapshot GET used by "현재 일정 확인".
    await page.route(new RegExp('/api/trips/' + trip + '$'), async (r) => {
      if (holdCheck && r.request().method() === 'GET') {
        await new Promise<void>((resolve) => { releaseCheck = resolve; });
      }
      return r.continue();
    });
    const ownerId = (await (await page.request.get('/api/auth/me')).json()).user.id;
    await page.addInitScript((id) => { (window as any).__recoveryOwner = id; }, ownerId);
    await page.goto('/trips/' + trip);
    const panel = page.getByRole('region', { name: '하루 코스 추천', exact: true });
    const names = () => page.locator('.itinerary-stop .stop-name').allTextContents();
    const marker = () => page.evaluate(() => sessionStorage.getItem('bookhaedo-course-recovery:v1:' + (window as any).__recoveryOwner));
    log['0 day1 items before save'] = await names();
    await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
    await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
    fault = 'after';
    await page.getByRole('button', { name: '이 코스로 하루 교체', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('저장 응답을 확인하지 못했어요');
    fault = 'none';
    log['1 marker after lost response (should exist)'] = !!(await marker());
    const truth1 = (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items.map((p: any) => p.name);
    log['2 server truth for day1 (committed)'] = truth1;
    log['3 UI day1 still shows (stale until refreshed)'] = await names();
    // Start the check, hold its GET, then leave the day.
    holdCheck = true;
    await panel.getByRole('button', { name: '현재 일정 확인', exact: true }).click();
    await expect.poll(() => !!releaseCheck).toBe(true);
    await page.locator('.day-tabs button').nth(1).click();
    holdCheck = false;
    releaseCheck?.();
    releaseCheck = undefined;
    await expect.poll(async () => await marker(), { timeout: 8000 }).toBeNull(); // marker cleared once the check finished
    log['4 marker cleared after late check success'] = (await marker()) === null;
    await page.locator('.day-tabs button').nth(0).click();
    await page.waitForTimeout(500);
    const shown = await names();
    log['5 UI day1 after returning'] = shown;
    log['6 UI matches server truth'] = JSON.stringify(shown) === JSON.stringify(truth1);
    await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
    log['7 recovery warning visible after returning'] = await panel.getByRole('button', { name: '현재 일정 확인', exact: true }).count();
    writeFileSync(process.env.PROBE_OUT!, JSON.stringify(log, null, 1));
  } finally {
    releaseCheck?.();
    await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
    await db.query('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [ids]);
    await db.end();
  }
});
