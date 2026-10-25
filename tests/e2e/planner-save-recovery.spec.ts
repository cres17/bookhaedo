import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// 일정 순서 저장(PUT /items)의 응답이 끊겼을 때 화면이 DB와 다른 순서를 보여 주지 않는지 확인한다.
// after: 서버는 저장했지만 응답이 유실됨 / before: 요청이 서버에 닿기 전에 실패함
const listedOrder = (page: Page) =>
  page
    .locator('.stop-actions .icon-button[aria-label$=" 아래로 이동"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('aria-label')!.replace(/ 아래로 이동$/, '')),
    );

test('일정 순서 저장 응답 유실 시 최신 일정을 다시 불러와 결과를 알린다', async ({ page }) => {
  const email = randomUUID() + '@example.test';
  const ids = Array.from({ length: 3 }, () => randomUUID());
  const names = ['순서 검증 A', '순서 검증 B', '순서 검증 C'];
  const db = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
  });
  let trip = '',
    writes = 0,
    fault: 'none' | 'before' | 'after' = 'none';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const savedOrder = async () => {
    const data = (await (await page.request.get('/api/trips/' + trip)).json()).data;
    const day = data.days.find((d: any) => d.date === '2026-10-10');
    return day.items.map((p: any) => p.name);
  };
  try {
    for (const [i, id] of ids.entries())
      await db.query(
        `INSERT INTO geo_data.place(id,region_id,category,name_ja,name_ko,normalized_name,latitude,longitude,location,region_distance_km,osm_tags) VALUES($1,'sapporo','ATTRACTION',$2,$2,$1,$3,141.35,ST_SetSRID(ST_MakePoint(141.35,$3),4326)::geography,0,'{"tourism":"museum"}')`,
        [id, names[i], 43.06 + i * 0.001],
      );
    expect(
      (
        await page.request.post('/api/auth/register', {
          data: { email, name: 'order-recovery', password: 'recovery-password' },
        })
      ).status(),
    ).toBe(201);
    const created = await page.request.post('/api/trips', {
      data: { title: '순서 저장 복구', startDate: '2026-10-10', days: 1, transportMode: 'WALK' },
    });
    trip = (await created.json()).data.id;
    expect(
      (
        await page.request.put(`/api/trips/${trip}/days/2026-10-10/items`, {
          data: { placeIds: ids, expectedRevision: 0 },
        })
      ).status(),
    ).toBe(200);

    await page.route('https://maps.googleapis.com/**', (r) => r.abort());
    await page.route('**/api/weather?*', (r) => r.fulfill({ json: { available: false } }));
    await page.route('**/routes', (r) => r.fulfill({ json: { segments: [] } }));
    await page.route('**/days/*/items', async (r) => {
      if (r.request().method() !== 'PUT') return r.fallback();
      writes++;
      if (fault === 'before') return r.abort('failed');
      if (fault === 'after') {
        expect((await r.fetch()).status()).toBe(200);
        return r.abort('failed');
      }
      return r.fallback();
    });

    await page.goto('/trips/' + trip);
    await expect.poll(() => listedOrder(page)).toEqual(names);
    const alert = page.locator('.planner-page p[role="alert"]').first();

    // 1) 저장은 됐지만 응답이 끊김: 화면이 저장된 순서로 바뀌고 저장됐다고 알린다
    fault = 'after';
    await page.getByRole('button', { name: '순서 검증 A 아래로 이동' }).click();
    await expect.poll(savedOrder).toEqual(['순서 검증 B', '순서 검증 A', '순서 검증 C']);
    await expect
      .poll(() => listedOrder(page))
      .toEqual(['순서 검증 B', '순서 검증 A', '순서 검증 C']);
    await expect(page.getByRole('status')).toContainText('다시 확인해 보니 변경이 저장됐어요');
    await expect(page.locator('.planner-page p[role="alert"]')).toHaveCount(0);
    expect(writes).toBe(1);

    // 2) 요청이 서버에 닿기 전에 실패: 화면은 저장된 순서를 유지하고 반영되지 않았다고 알린다
    fault = 'before';
    await page.getByRole('button', { name: '순서 검증 C 위로 이동' }).click();
    await expect(alert).toContainText('반영되지 않았어요');
    expect(await savedOrder()).toEqual(['순서 검증 B', '순서 검증 A', '순서 검증 C']);
    await expect
      .poll(() => listedOrder(page))
      .toEqual(['순서 검증 B', '순서 검증 A', '순서 검증 C']);
    expect(writes).toBe(2);

    // 3) 정상 저장은 그대로 동작하고 이전 오류 안내를 지운다
    fault = 'none';
    await page.getByRole('button', { name: '순서 검증 C 위로 이동' }).click();
    await expect.poll(savedOrder).toEqual(['순서 검증 B', '순서 검증 C', '순서 검증 A']);
    await expect
      .poll(() => listedOrder(page))
      .toEqual(['순서 검증 B', '순서 검증 C', '순서 검증 A']);
    await expect(page.getByRole('status')).toContainText('변경한 일정을 저장했어요');
    await expect(page.locator('.planner-page p[role="alert"]')).toHaveCount(0);
    expect(writes).toBe(3);
    expect(errors).toEqual([]);
  } finally {
    if (email) await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
    await db.query('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [ids]);
    await db.end();
  }
});
