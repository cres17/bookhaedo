import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

for (const mobile of [false, true])
  test(`날씨 대안: 비교·취소·교체·재조회 (${mobile ? '모바일' : '데스크톱'})`, async ({ page }) => {
    const email = `weather-e2e-${randomUUID()}@example.test`,
      db = new pg.Pool({
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
      });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const found = await db.query(
        `SELECT a.id AS target,b.id AS candidate FROM geo_data.place a JOIN geo_data.place b ON ST_DWithin(a.location,b.location,10000) WHERE a.osm_tags->>'leisure'='park' AND b.osm_tags->>'tourism'='museum' AND COALESCE(b.osm_tags->>'indoor','')<>'no' AND COALESCE(b.osm_tags->>'access','') NOT IN ('private','no') LIMIT 1`,
      );
      const { target, candidate } = found.rows[0];
      const places = await db.query(
        `SELECT id,COALESCE(name_ko,name_ja) AS name,name_ja AS "nameJa",latitude,longitude,osm_tags AS tags,category FROM geo_data.place WHERE id=ANY($1::text[])`,
        [[target, candidate]],
      );
      const old = places.rows.find((p) => p.id === target),
        replacement = {
          ...places.rows.find((p) => p.id === candidate),
          indoorEvidence: '박물관 분류',
          distanceMeters: 1200,
          operationNotice: '방문 전 운영시간 확인 필요',
        };
      await page.request.post('/api/auth/register', {
        data: { email, name: '날씨 UI 검증', password: 'weather-e2e-password' },
      });
      const trip = (
        await (
          await page.request.post('/api/trips', {
            data: { title: '날씨 대안 검증', startDate: '2026-09-10', days: 2 },
          })
        ).json()
      ).data.id;
      const base = `/api/trips/${trip}/days/2026-09-10`;
      await page.request.put(base + '/items', {
        data: { expectedRevision: 0, placeIds: [target] },
      });
      const weather = {
        available: true,
        description: '비',
        high: 21,
        low: 16,
        precipitationMm: 10,
        source: 'Open-Meteo',
        sourceUrl: 'https://open-meteo.com/',
      };
      let status = 'READY',
        failSave = false;
      await page.route('https://maps.googleapis.com/**', (r) => r.abort());
      await page.route('**/api/weather?*', (r) => r.fulfill({ json: weather }));
      await page.route('**/routes', (r) => r.fulfill({ json: { segments: [] } }));
      await page.route('**/weather-alternatives*', async (r) => {
        if (r.request().method() === 'PATCH') {
          if (failSave)
            return r.fulfill({
              status: 409,
              json: { error: '일정이 변경됐어요. 다시 확인해주세요.' },
            });
          return r.continue();
        }
        const preview = new URL(r.request().url()).searchParams.has('previewId');
        await r.fulfill({
          json: {
            tripId: trip,
            date: '2026-09-10',
            expectedRevision: 1,
            status,
            weather: status === 'NO_FORECAST' ? { available: false } : weather,
            target: old,
            expectedPlaceIds: [target],
            notice:
              status === 'NO_FORECAST' ? '예보 범위 밖이에요.' : '예보·실내 분류 기준 후보입니다.',
            data: status === 'READY' ? [replacement] : [],
            preview:
              preview && status === 'READY'
                ? {
                    candidate: replacement,
                    before: { segments: [], complete: true, distanceMeters: 0, durationSeconds: 0 },
                    after: { segments: [], complete: true, distanceMeters: 0, durationSeconds: 0 },
                    durationDeltaSeconds: 0,
                  }
                : null,
          },
        });
      });
      await page.goto('/trips/' + trip);
      await page.getByRole('button', { name: '대안 장소 보기', exact: true }).click();
      await expect(page.getByRole('region', { name: '날씨 기반 대안 추천' })).toBeVisible();
      await page.getByRole('button', { name: '이 장소로 미리보기' }).click();
      await expect(page.getByRole('heading', { name: '변경 미리보기' })).toBeVisible();
      await page.screenshot({
        path: `test-results/weather-${mobile ? 'mobile' : 'desktop'}.png`,
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole('button', { name: '기존 일정 유지' }).click();
      expect(
        (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items[0].id,
      ).toBe(target);
      await page.getByRole('button', { name: '대안 장소 보기', exact: true }).click();
      await page.getByRole('button', { name: '이 장소로 미리보기' }).click();
      failSave = true;
      await page.getByRole('button', { name: '이 장소로 교체 확정' }).click();
      await expect(page.getByRole('alert')).toContainText('일정이 변경');
      expect(
        (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items[0].id,
      ).toBe(target);
      await page.getByRole('button', { name: '대안 추천 닫기' }).click();
      status = 'NO_CANDIDATES';
      await page.getByRole('button', { name: '대안 장소 보기', exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: '가까운 실내 대안을 찾지 못했어요' }),
      ).toBeVisible();
      await page.getByRole('button', { name: '대안 추천 닫기' }).click();
      status = 'NO_FORECAST';
      await page.getByRole('button', { name: '대안 장소 보기', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '예보 범위 밖' })).toBeVisible();
      await page.getByRole('button', { name: '대안 추천 닫기' }).click();
      status = 'READY';
      failSave = false;
      await page.getByRole('button', { name: '대안 장소 보기', exact: true }).click();
      await page.getByRole('button', { name: '이 장소로 미리보기' }).click();
      await page.getByRole('button', { name: '이 장소로 교체 확정' }).click();
      await expect(page.locator('.stop-name')).toHaveText(replacement.name);
      await page.reload();
      await expect(page.locator('.stop-name')).toHaveText(replacement.name);
      expect(errors).toEqual([]);
    } finally {
      await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
      await db.end();
    }
  });
