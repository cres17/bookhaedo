import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
test('Book해도 브랜딩·메모·이동 비교·여행 삭제를 실제 REST와 DB로 검증', async ({ page }) => {
  const email = 'bookhaedo-' + randomUUID() + '@example.test',
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const date = '2026-10-01',
    places = ['761caacf-fd2a-5076-852c-65e876d063ff', '0f338d0c-78dc-5e12-80c4-c230783dbb79'];
  try {
    await page.route('https://maps.googleapis.com/**', (r) => r.abort());
    await page.route('**/api/places/*/enrichment', (r) =>
      r.fulfill({
        json: { available: false, notice: 'Google enrichment disabled in this UI test' },
      }),
    );
    await page.request.post('/api/auth/register', {
      data: { email, password: 'bookhaedo-password-42', name: '북해도 테스트' },
    });
    const created = await page.request.post('/api/trips', {
        data: { title: '삭제 검증 여행', startDate: date, days: 1, transportMode: 'DRIVE' },
      }),
      id = (await created.json()).data.id;
    await page.request.put('/api/trips/' + id + '/days/' + date + '/items', {
      data: { expectedRevision: 0, placeIds: places },
    });
    await page.goto('/trips/' + id);
    await expect(page).toHaveTitle(/Book해도/);
    await expect(page.getByRole('link', { name: 'Book해도. 홈' })).toBeVisible();
    await page.locator('.stop-note summary').first().click();
    await page.locator('textarea').first().fill('14시 예약 · 창가 자리');
    await page.getByRole('button', { name: '메모 저장' }).first().click();
    await expect(page.locator('.toast-message')).toContainText('메모를 저장');
    await page.reload();
    await page.locator('.stop-note summary').first().click();
    await expect(page.locator('textarea').first()).toHaveValue('14시 예약 · 창가 자리');
    await page.getByRole('button', { name: '이동방법 비교', exact: true }).click();
    await expect(page.locator('.route-options article:not(.transit-external)')).toHaveCount(3, {
      timeout: 40000,
    });
    await expect(page.locator('.route-options')).toContainText('도보');
    await expect(page.locator('.route-options')).toContainText('자전거');
    await page.screenshot({ path: 'docs/screenshots/bookhaedo-planner.png', fullPage: true });
    await page.goto('/places/' + places[0]);
    await expect(page.getByRole('heading', { name: '리뷰로 살펴보는 관심의 흐름' })).toHaveCount(0);
    await expect(page.locator('.review-trend')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '장소명 복사', exact: true })).toBeVisible();
    await page.goto('/trips');
    const tile = page.locator('.trip-tile').first(),
      menu = tile.locator('.trip-menu');
    await expect(menu).toBeVisible();
    const tileBox = await tile.boundingBox(),
      menuBox = await menu.boundingBox();
    expect(
      tileBox &&
        menuBox &&
        menuBox.x > tileBox.x + tileBox.width - 80 &&
        menuBox.y < tileBox.y + 70,
    ).toBe(true);
    await page.screenshot({ path: 'docs/screenshots/trips-collection.png', fullPage: true });
    await page.getByLabel('삭제 검증 여행 여행 메뉴').click();
    await page.getByRole('button', { name: '여행 이름 수정', exact: true }).click();
    await page.getByRole('dialog').getByLabel('여행 이름').fill('수정된 여행');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByRole('heading', { name: '수정된 여행' })).toBeVisible();
    await page.getByRole('button', { name: '여행 삭제', exact: true }).click();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    expect((await page.request.get('/api/trips/' + id)).status()).toBe(200);
    await page
      .locator('.trip-menu')
      .getByRole('button', { name: '여행 삭제', exact: true })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: '여행 삭제', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await page.request.get('/api/trips/' + id)).status()).toBe(404);
    expect((await page.request.get('/api/places/' + places[0])).status()).toBe(200);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
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
