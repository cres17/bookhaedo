import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
test('지역 소개 → 통합검색 → 페이지·상세 복원, 지도 유지, 모바일과 눈 모션', async ({ page }) => {
  const email = 'explore-flow-' + randomUUID() + '@example.test',
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.request.post('/api/auth/register', {
      data: { email, password: 'explore-flow-password', name: '탐색 확인' },
    });
    await page.route('**/api/places/*/enrichment', (r) =>
      r.fulfill({ json: { available: false } }),
    );
    await page.goto('/explore?region=otaru');
    await expect(page.getByLabel('지역 또는 장소 검색')).toHaveAttribute(
      'placeholder',
      '지역 이름 또는 가고 싶은 장소',
    );
    await expect(page.locator('.story-content h2')).toHaveText('오타루');
    await expect(page.locator('.story-content')).toContainText('운하');
    await expect(page.locator('.place-card')).toHaveCount(12);
    await expect(page.locator('.map-loading')).toBeHidden({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: '마음이 가는 장면을 골라요.' })).toBeVisible();
    const beforeThemeScroll = await page.locator('.journey-panel').evaluate((el) => el.scrollTop);
    await page.getByRole('button', { name: '자연 속으로', exact: true }).click();
    await expect(page.locator('.recommendation-reason').first()).toBeVisible();
    await expect
      .poll(() => page.locator('.journey-panel').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(beforeThemeScroll + 100);
    await expect(page.getByRole('button', { name: '일반 검색으로', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '먹을 곳', exact: true }).click();
    await expect(page.getByRole('button', { name: '먹을 곳', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '전체', exact: true }).click();
    await expect(page.locator('.place-card')).toHaveCount(12);
    await expect(page.locator('.result-scroll')).toHaveAttribute('aria-busy', 'false');
    await page
      .locator('.journey-map')
      .evaluate((el) => el.setAttribute('data-instance-check', 'same'));
    await page.screenshot({ path: 'docs/screenshots/explore-chapter-desktop.png', fullPage: true });
    const response = page.waitForResponse(
      (r) =>
        r.url().includes('/api/places?') && new URL(r.url()).searchParams.get('offset') === '12',
    );
    await page.getByRole('button', { name: '다음 장소 →', exact: true }).click();
    const received = await response;
    expect(received.status()).toBe(200);
    const expectedPage = (await received.json()).data;
    await expect(page.locator('.place-pagination')).toContainText('2 /');
    await expect(page.locator('.place-card strong').first()).toHaveText(expectedPage[0].name);
    await expect(page.locator('.place-page-enter-active,.place-page-leave-active')).toHaveCount(0);
    const names = await page.locator('.place-card strong').allTextContents();
    await page.locator('.place-card').first().click();
    await page.getByRole('link', { name: '탐색으로 돌아가기' }).click();
    await expect(page.locator('.place-pagination')).toContainText('2 /');
    await expect(page.locator('.place-card strong').first()).toHaveText(names[0]!);
    await page.getByLabel('지역 또는 장소 검색').fill('삿포로 공원');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await expect(page.locator('.story-content h2')).toHaveText('삿포로');
    await expect(page.locator('.result-scroll')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('button', { name: '다시 추천', exact: true })).toHaveCount(0);
    await page.getByLabel('여행 지역', { exact: true }).selectOption('sapporo');
    await expect(page.locator('.story-content h2')).toHaveText('삿포로');
    await expect(page.locator('.results-heading')).toContainText('삿포로');
    await expect(page.locator('.result-scroll')).toHaveAttribute('aria-busy', 'false');
    await page
      .locator('.journey-map')
      .evaluate((el) => el.setAttribute('data-instance-check', 'same'));
    await page.getByRole('button', { name: '다음 지역', exact: true }).click();
    await expect(page.locator('.story-content h2')).toHaveText('오타루');
    await expect(page.locator('.journey-map')).toHaveAttribute('data-instance-check', 'same');
    await page.getByRole('button', { name: '눈 효과 멈추기' }).click();
    await expect(page.getByRole('button', { name: '눈 효과 재생' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.journey-panel').evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: 'docs/screenshots/explore-chapter-mobile.png', fullPage: true });
    const before = await page.locator('.journey-map').boundingBox();
    await page.locator('.journey-panel').evaluate((el) => (el.scrollTop = 900));
    const after = await page.locator('.journey-map').boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(after!.height).toBeGreaterThan(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.snow-scene')).toBeHidden();
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
test('빠른 검색 전환 시 늦은 응답 무시·API 실패 복구', async ({ page }) => {
  const email = 'explore-race-' + randomUUID() + '@example.test';
  try {
    await page.route('https://maps.googleapis.com/**', (r) => r.abort());
    await page.request.post('/api/auth/register', {
      data: { email, password: 'explore-race-password', name: '응답 확인' },
    });
    await page.goto('/explore?region=sapporo');
    await expect(page.locator('.place-card')).toHaveCount(12);
    await page.route('**/api/places?**', async (r) => {
      const q = new URL(r.request().url()).searchParams.get('q');
      if (q === '오타루 일식') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await r.fulfill({ json: { data: [], count: 0, notice: 'STALE_RESPONSE' } });
      } else if (q === '하코다테 양식')
        await r.fulfill({ status: 503, json: { error: '테스트용 일시적인 API 오류' } });
      else await r.continue();
    });
    await page.getByLabel('지역 또는 장소 검색').fill('오타루 일식');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await page.getByLabel('지역 또는 장소 검색').fill('삿포로 공원');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await expect(page.locator('.discovery-notice')).toContainText('분류');
    await expect(page.locator('.discovery-notice')).not.toContainText('STALE_RESPONSE');
    await page.getByLabel('지역 또는 장소 검색').fill('하코다테 양식');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('일시적인 API 오류');
    await expect(page.locator('.place-card')).toHaveCount(0);
    await page.getByRole('button', { name: '검색어 지우기', exact: true }).click();
    await expect(page.locator('.place-card')).toHaveCount(12);
    await expect(page.getByRole('alert')).toHaveCount(0);
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
