import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { writeFile } from 'node:fs/promises';
test('실제 Google 지도·지역 검색·경로·날씨의 REST → Vue 연결 확인', async ({ page }) => {
  const email = `map-qa-${randomUUID()}@example.test`;
  const messages: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('Google Maps JavaScript API error'))
      messages.push(m.text().replace(/key=[^&\s]+/g, 'key=[REDACTED]'));
  });
  try {
    await page.request.post('/api/auth/register', {
      data: { email, password: 'map-test-password', name: '지도 확인' },
    });
    await page.goto('/explore');
    await expect(page.locator('.place-card').first()).toBeVisible();
    await expect(page.locator('.map-loading')).toBeHidden({ timeout: 20000 });
    await page.waitForTimeout(1500); // Google authentication can fail after the Map constructor returns.
    const ready =
      (await page.locator('.google-canvas .gm-style').count()) > 0 &&
      !(await page.locator('.map-fallback').count()) &&
      messages.length === 0;
    if (ready) {
      await page.getByLabel('지역 또는 장소 검색').fill('오타루');
      await page.getByRole('button', { name: '검색', exact: true }).click();
      await expect(page.locator('.results-heading')).toContainText('오타루');
      await page.screenshot({ path: 'docs/screenshots/explore-google-live.png', fullPage: true });
    } else
      await page.screenshot({
        path: 'docs/screenshots/explore-google-fallback.png',
        fullPage: true,
      });
    await writeFile(
      'docs/google-browser-check.json',
      JSON.stringify(
        { checkedAt: new Date().toISOString(), mapReady: ready, consoleErrors: messages },
        null,
        2,
      ),
    );
    expect(
      ready,
      'Google 지도는 실제 API 키와 허용 도메인 설정이 필요합니다. docs/google-browser-check.json 참고',
    ).toBe(true);
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const created = await page.request.post('/api/trips', {
      data: { title: '실시간 연결 검증', startDate: date, days: 1, transportMode: 'DRIVE' },
    });
    expect(created.status()).toBe(201);
    const tripId = (await created.json()).data.id;
    const places = ['761caacf-fd2a-5076-852c-65e876d063ff', '0f338d0c-78dc-5e12-80c4-c230783dbb79'];
    expect(
      (
        await page.request.put(`/api/trips/${tripId}/days/${date}/items`, {
          data: { expectedRevision: 0, placeIds: places },
        })
      ).ok(),
    ).toBe(true);
    const routeResponse = page.waitForResponse((r) => r.url().includes(`/days/${date}/routes`));
    const weatherResponse = page.waitForResponse((r) => r.url().includes('/api/weather?'));
    await page.goto(`/trips/${tripId}`);
    const routes = await (await routeResponse).json();
    expect(routes.segments).toHaveLength(1);
    expect(routes.segments[0].source).toBe('valhalla');
    expect(routes.segments[0].durationSeconds).toBeGreaterThan(0);
    expect(routes.segments[0].coordinates.length).toBeGreaterThan(1);
    const weather = await (await weatherResponse).json();
    expect(weather.available).toBe(true);
    expect(weather.source).toBe('Open-Meteo');
    await expect(page.locator('.route-default-summary')).toContainText('분');
    await expect(page.locator('.route-default-summary')).not.toContainText('직선거리');
    await expect(page.locator('.weather-chip')).toContainText('Open-Meteo');
    await expect(page.locator('.map-loading')).toBeHidden();
    await expect(page.locator('.map-fallback')).toHaveCount(0);
    await page.waitForTimeout(1800); // Let fitBounds finish and replacement map tiles paint before visual QA.
    await page.screenshot({ path: 'docs/screenshots/planner-google-live.png', fullPage: true });
    await writeFile(
      'docs/google-browser-check.json',
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          mapReady: ready,
          consoleErrors: messages,
          routeSource: routes.segments[0].source,
          distanceMeters: routes.segments[0].distanceMeters,
          durationSeconds: routes.segments[0].durationSeconds,
          geometryPresent: !!routes.segments[0].coordinates,
          weatherSource: weather.source,
          weatherAvailable: weather.available,
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
