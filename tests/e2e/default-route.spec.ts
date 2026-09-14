import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('저장된 이동수단 결과와 비교 버튼을 같은 줄에 표시한다', async ({ page }, testInfo) => {
  const password = 'default-route-password';
  const places = ['761caacf-fd2a-5076-852c-65e876d063ff', '0f338d0c-78dc-5e12-80c4-c230783dbb79'];
  try {
    await page.route('https://maps.googleapis.com/**', (r) => r.abort());
    // Rendering contract: deterministic provider result, real trip and saved mode.
    await page.route('**/days/*/routes', (r) =>
      r.fulfill({
        json: {
          segments: [
            {
              from: places[0],
              to: places[1],
              source: 'valhalla',
              distanceMeters: 3100,
              durationSeconds: 480,
              coordinates: [],
            },
          ],
        },
      }),
    );
    await page.request.post('/api/auth/register', {
      data: { email: `default-route-${randomUUID()}@example.test`, password, name: '경로 확인' },
    });
    const result = await page.request.post('/api/trips', {
      data: {
        title: '이동수단 기본 표시',
        startDate: '2026-10-01',
        days: 1,
        transportMode: 'WALK',
      },
    });
    const id = (await result.json()).data.id;
    await page.request.put(`/api/trips/${id}/days/2026-10-01/items`, {
      data: { expectedRevision: 0, placeIds: places },
    });
    await page.goto('/trips/' + id);
    for (const [mode, name] of [
      ['WALK', '도보'],
      ['DRIVE', '렌터카'],
      ['BICYCLE', '자전거'],
      ['TAXI', '택시'],
    ]) {
      await page.request.patch('/api/trips/' + id, {
        data: { title: '이동수단 기본 표시', transportMode: mode },
      });
      await page.reload();
      await expect(page.locator('.route-default-summary')).toContainText(name!);
      await expect(page.locator('.route-default-summary')).toContainText('3.1 km · 8분');
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      const summary = await page.locator('.route-default-summary').boundingBox();
      const button = await page
        .getByRole('button', { name: '이동방법 비교', exact: true })
        .boundingBox();
      expect(button!.x).toBeGreaterThanOrEqual(summary!.x + summary!.width);
      expect(
        Math.abs(button!.y + button!.height / 2 - summary!.y - summary!.height / 2),
      ).toBeLessThan(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`default-route-${width}.png`),
        fullPage: true,
      });
    }
    await page.request.patch('/api/trips/' + id, {
      data: { title: '이동수단 기본 표시', transportMode: 'TRANSIT' },
    });
    let routeRequests = 0;
    page.on('request', (request) => {
      if (/\/days\/[^/]+\/routes$/.test(request.url())) routeRequests++;
    });
    await page.reload();
    const link = page
      .locator('.route-default-summary')
      .getByRole('link', { name: 'Google 지도에서 길찾기' });
    await expect(link).toBeVisible();
    const url = new URL((await link.getAttribute('href'))!);
    expect(url.origin).toBe('https://www.google.com');
    expect(url.searchParams.get('travelmode')).toBe('transit');
    expect(url.searchParams.get('origin')).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    expect(url.searchParams.get('destination')).not.toBe(url.searchParams.get('origin'));
    expect(routeRequests).toBe(0);
    await expect(page.locator('.route-default-summary')).not.toContainText('시간 정보 없음');
  } finally {
    await page.request.delete('/api/auth/me', { data: { password } });
  }
});
