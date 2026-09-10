import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { pool } from '../../server/db';
test('미제공 사이트 숨김·좌표 대신 원문 이름으로 Google 검색', async ({ page }) => {
  const email = `links-${randomUUID()}@example.test`;
  try {
    await page.request.post('/api/auth/register', {
      data: { email, password: 'test-password-42', name: '링크 검증' },
    });
    await page.route('https://maps.googleapis.com/**', (r) => r.abort());
    await page.route('**/api/places/*/enrichment', (r) =>
      r.fulfill({ json: { available: false } }),
    );
    const place = (await (await page.request.get('/api/places?limit=1')).json()).data[0];
    await page.route('**/api/places/' + place.id, async (r) => {
      const response = await r.fetch();
      const body = await response.json();
      body.data.website = null;
      await r.fulfill({ json: body });
    });
    await page.goto('/places/' + place.id);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /등록된 웹사이트|공식 웹사이트|공식 홈페이지/ }),
    ).toHaveCount(0);
    const url = new URL(
      (await page.getByRole('link', { name: 'Google Maps에서 보기' }).getAttribute('href'))!,
    );
    expect(url.searchParams.get('query')).toContain(place.nameJa);
    expect(url.searchParams.get('query')).not.toContain(String(place.latitude));
    expect(url.searchParams.get('query')).toContain('北海道');
  } finally {
    await pool.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
  }
});
