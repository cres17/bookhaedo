import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

test('맑은 날에도 하루 전체 코스를 비교하고 확인 후 교체한다', async ({ page }) => {
  const email = `day-plan-e2e-${randomUUID()}@example.test`,
    db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
    }),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const found = await db.query(
      `SELECT id,COALESCE(name_ko,name_ja) AS name,name_ja AS "nameJa",category,latitude,longitude,osm_tags AS tags FROM geo_data.place WHERE region_id='sapporo' AND category<>'LODGING' ORDER BY (name_ko IS NOT NULL) DESC,(website IS NOT NULL) DESC LIMIT 5`,
    );
    const [old1, old2, ...candidates] = found.rows;
    expect(candidates).toHaveLength(3);
    await page.request.post('/api/auth/register', {
      data: { email, name: '하루 코스 UI 검증', password: 'day-plan-e2e-password' },
    });
    const trip = (
      await (
        await page.request.post('/api/trips', {
          data: { title: '하루 전체 추천 검증', startDate: '2026-09-10', days: 1 },
        })
      ).json()
    ).data.id;
    const base = `/api/trips/${trip}/days/2026-09-10`;
    await page.request.put(base + '/items', {
      data: { expectedRevision: 0, placeIds: [old1.id, old2.id] },
    });
    const weather = {
      available: true,
      date: '2026-09-10',
      description: '맑음',
      high: 22,
      low: 13,
      precipitationProbability: 10,
      source: 'Open-Meteo',
      sourceUrl: 'https://open-meteo.com/',
    };
    const plan = {
      id: 'NEARBY',
      label: '가까운 곳 중심 코스',
      reason: '현재 일정의 중심에서 가까운 후보부터 묶었어요.',
      places: candidates,
      distanceMeters: 4200,
    };
    await page.route('https://maps.googleapis.com/**', (r) => r.abort());
    await page.route('**/api/weather?*', (r) => r.fulfill({ json: weather }));
    await page.route('**/routes', (r) => r.fulfill({ json: { segments: [] } }));
    await page.route('**/day-alternatives*', async (r) => {
      if (r.request().method() === 'PATCH') return r.continue();
      const preview = new URL(r.request().url()).searchParams.has('strategy');
      await r.fulfill({
        json: {
          tripId: trip,
          date: '2026-09-10',
          expectedRevision: 1,
          status: 'READY',
          weather,
          weatherMode: 'FAIR',
          expectedPlaceIds: [old1.id, old2.id],
          plans: [plan],
          preview: preview
            ? {
                plan,
                segments: [
                  {
                    from: candidates[0].id,
                    to: candidates[1].id,
                    source: 'valhalla',
                    distanceMeters: 1800,
                    durationSeconds: 900,
                  },
                  {
                    from: candidates[1].id,
                    to: candidates[2].id,
                    source: 'valhalla',
                    distanceMeters: 2400,
                    durationSeconds: 1200,
                  },
                ],
                complete: true,
                distanceMeters: 4200,
                durationSeconds: 2100,
              }
            : null,
          notice: '확정 전까지 일정은 바뀌지 않아요.',
        },
      });
    });
    await page.goto('/trips/' + trip);
    await expect(page.getByText('맑음').first()).toBeVisible();
    await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
    await expect(page.getByRole('region', { name: '하루 코스 추천' })).toBeVisible();
    await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
    await expect(page.getByRole('heading', { name: '하루 코스 변경 미리보기' })).toBeVisible();
    await expect(page.getByText('실제 경로 4.2km')).toBeVisible();
    await page.getByRole('button', { name: '기존 일정 유지' }).click();
    expect(
      (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items.map(
        (p: any) => p.id,
      ),
    ).toEqual([old1.id, old2.id]);
    await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
    await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
    await page.getByRole('button', { name: '이 코스로 하루 교체' }).click();
    await expect(page.locator('.stop-name')).toHaveCount(3);
    expect(
      (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items.map(
        (p: any) => p.id,
      ),
    ).toEqual(candidates.map((p) => p.id));
    expect(errors).toEqual([]);
  } finally {
    await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
    await db.end();
  }
});
