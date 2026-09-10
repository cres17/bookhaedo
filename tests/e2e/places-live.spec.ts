import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { writeFile } from 'node:fs/promises';
test('실제 Places 한국어 상세·사진·리뷰와 출처 표시', async ({ page }) => {
  const email = 'places-live-' + randomUUID() + '@example.test';
  try {
    await page.request.post('/api/auth/register', {
      data: { email, password: 'places-live-123', name: '상세 검증' },
    });
    const responsePromise = page.waitForResponse((r) => r.url().includes('/enrichment'));
    await page.goto('/places/0f338d0c-78dc-5e12-80c4-c230783dbb79');
    const response = await responsePromise,
      data = await response.json();
    expect(data.available, data.notice).toBe(true);
    expect(data.nameKo).toMatch(/[가-힣]/);
    const stored = (
      await (await page.request.get('/api/places/0f338d0c-78dc-5e12-80c4-c230783dbb79')).json()
    ).data;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(stored.name);
    await expect(page.locator('.detail-metadata')).toContainText('평점');
    await expect(page.locator('.review-list article')).toHaveCount(data.reviews.length);
    await expect(page.locator('.detail-photo')).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.detail-photo')
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    await expect(page.locator('.map-loading')).toBeHidden({ timeout: 20000 });
    await page.screenshot({ path: 'docs/screenshots/detail-google-live.png', fullPage: true });
    await writeFile(
      'docs/places-browser-check.json',
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          detailAvailable: true,
          koreanName: data.nameKo,
          photoLoaded: true,
          reviewSampleCount: data.reviews.length,
          attributionVisible: await page.getByText('Google Maps에서 제공한 정보').isVisible(),
        },
        null,
        2,
      ),
    );
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
