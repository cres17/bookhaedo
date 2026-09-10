import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
test('계속 탐색·지역·분류 검색·중복 알림 닫기', async ({ page }) => {
  const email = 'improvements-' + randomUUID() + '@example.test';
  try {
    await page.route('https://maps.googleapis.com/**', (r) => r.abort());
    await page.route('**/api/places/*/enrichment', (r) =>
      r.fulfill({ json: { available: false, notice: '추가 정보 미제공 테스트' } }),
    );
    await page.request.post('/api/auth/register', {
      data: { email, password: 'test-improvements-123', name: 'UX 검증' },
    });
    const created = await page.request.post('/api/trips', {
        data: { title: 'UX 검증', startDate: '2026-10-01', days: 2, transportMode: 'TAXI' },
      }),
      id = (await created.json()).data.id;
    await page.goto('/trips/' + id);
    await page.getByRole('link', { name: '첫 장소 찾기' }).click();
    await page.getByLabel('지역 또는 장소 검색').fill('삿포로');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await page.locator('.place-card').first().click();
    const detailUrl = page.url();
    await page.getByRole('button', { name: '여행에 담기' }).click();
    await page.getByRole('button', { name: '이 날짜에 담기' }).click();
    await expect(page).toHaveURL(detailUrl);
    await page.getByRole('link', { name: '계속 탐색하기', exact: true }).click();
    await expect(page).toHaveURL(/explore/);
    expect(
      (await (await page.request.get('/api/trips/' + id)).json()).data.days[0].items,
    ).toHaveLength(1);
    await page.getByLabel('지역 또는 장소 검색').fill('삿포로 공원');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await expect(page.locator('.discovery-notice')).toContainText('분류');
    await expect(page.getByLabel('지도 범례')).toContainText('먹을 곳');
    await expect(page.locator('.result-scroll')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.place-page-enter-active,.place-page-leave-active')).toHaveCount(0);
    await page.screenshot({ path: 'docs/screenshots/discovery-improved.png', fullPage: true });
    await page.goto(detailUrl);
    await page.getByRole('button', { name: '여행에 담기' }).click();
    await page.getByRole('button', { name: '이 날짜에 담기' }).click();
    await page.getByRole('button', { name: '이 날짜에 담기' }).click();
    await expect(page.locator('.toast-message')).toHaveCount(1);
    await page.getByRole('button', { name: '알림 닫기' }).click();
    await expect(page.locator('.toast-message')).toHaveCount(0);
  } finally {
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
    });
    await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
    await db.end();
  }
});
test('메인 지도는 실제 좌표의 12개 도시 이름을 항상 보여준다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hero .island-pin text')).toHaveCount(12);
  for (const city of ['삿포로', '아사히카와', '비에이', '노보리베츠', '구시로'])
    await expect(page.locator('.hero .island-pin text').filter({ hasText: city })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.hero .island-pin text')).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
