import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`공개 관광 자료 출처·미확정 표시와 확정 저장 (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const email = `tourism-ui-${randomUUID()}@example.test`;
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      const places = (
        await db.query(`SELECT id,COALESCE(name_ko,name_ja) AS name,name_ja AS "nameJa",category,latitude,longitude,osm_tags AS tags
        FROM geo_data.place WHERE region_id='sapporo' AND category<>'LODGING'
        ORDER BY (name_ko IS NOT NULL) DESC,(website IS NOT NULL) DESC LIMIT 5`)
      ).rows;
      const [first, second, ...additional] = places;
      await page.request.post('/api/auth/register', {
        data: { email, name: '관광 추천 UI', password: 'tourism-ui-password' },
      });
      const trip = (
        await (
          await page.request.post('/api/trips', {
            data: { title: '공개 관광 자료 검증', startDate: '2026-10-01', days: 1 },
          })
        ).json()
      ).data.id;
      const base = `/api/trips/${trip}/days/2026-10-01`;
      await page.request.put(base + '/items', {
        data: { placeIds: [first.id, second.id], expectedRevision: 0 },
      });
      const plan = {
        id: 'KNOWLEDGE',
        label: '공개 자료를 참고한 코스',
        reason: '출처를 확인하고 적용해요.',
        places: [first, ...additional.slice(0, 2)],
        distanceMeters: 1000,
        evidenceIds: ['facility'],
      };
      let saveRequests = 0;
      const recommendationRequests: any[] = [];
      await page.route('https://maps.googleapis.com/**', (r) => r.abort());
      await page.route('**/api/weather?*', (r) =>
        r.fulfill({ json: { available: false, notice: '예보 범위 밖' } }),
      );
      await page.route('**/routes', (r) => r.fulfill({ json: { segments: [] } }));
      await page.route('**/day-alternatives*', (r) => {
        if (r.request().method() === 'PATCH') {
          saveRequests++;
          return r.continue();
        }
        return r.fulfill({
          json: {
            plans: [],
            preview: null,
            weather: { available: false },
            notice: '기본 추천',
          },
        });
      });
      await page.route('**/ai-recommendations', async (r) => {
        const body = r.request().postDataJSON();
        recommendationRequests.push(body);
        const kept = [first, second].filter((p) => body.keepPlaceIds.includes(p.id));
        const requestedPlan = {
          ...plan,
          places: [...kept, ...plan.places.filter((p) => !body.keepPlaceIds.includes(p.id))].slice(
            0,
            3,
          ),
        };
        await r.fulfill({
          json: {
            tripId: trip,
            date: '2026-10-01',
            expectedRevision: 1,
            expectedPlaceIds: [first.id, second.id],
            status: 'READY',
            weather: { available: false },
            plans: [requestedPlan],
            preview: body.strategy
              ? {
                  plan: requestedPlan,
                  segments: [],
                  complete: false,
                  distanceMeters: null,
                  durationSeconds: null,
                }
              : null,
            evidence: [
              {
                id: 'facility',
                placeId: first.id,
                kind: 'place',
                title: '공개 시설 안내',
                excerpt: '<script>window.__tourismInjected=true</script>',
                publisher: '富良野市',
                resourceUrl: 'https://www.harp.lg.jp/opendata/dataset/2207.html',
                licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
                licenseId: 'CC-BY-4.0',
                fetchedAt: '2026-10-01T00:00:00Z',
                sourceUpdatedAt: null,
                hoursStatus: 'historical',
              },
              {
                id: 'event',
                placeId: null,
                kind: 'event',
                title: '행사 참고 자료',
                excerpt: '공개 CSV',
                publisher: '恵庭市',
                resourceUrl: 'https://www.harp.lg.jp/opendata/dataset/1823.html',
                licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
                licenseId: 'CC-BY-4.0',
                fetchedAt: '2026-10-01T00:00:00Z',
                startDate: '2026-10-01',
                endDate: '2026-10-02',
                dateStatus: 'tentative',
                locationStatus: 'missing',
              },
            ],
            notice: '확정 전에는 일정이 바뀌지 않아요.',
          },
        });
      });
      await page.goto('/trips/' + trip);
      await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
      await page.getByRole('checkbox', { name: '공개 관광 자료 함께 보기' }).check();
      await expect(page.getByRole('heading', { name: '함께 확인한 공개 자료' })).toBeVisible();
      await page.getByText('공개 시설 안내', { exact: true }).click();
      await expect(page.getByText('과거 영업시간 포함')).toBeVisible();
      await page.getByText('행사 참고 자료 · 행사 참고', { exact: true }).click();
      await expect(page.getByText('개최 미확정 · 변경 가능')).toBeVisible();
      await expect(page.getByText('자료에 좌표 없음')).toBeVisible();
      expect(await page.evaluate(() => !!(window as any).__tourismInjected)).toBe(false);
      const source = page.getByRole('link', { name: '恵庭市 원문 CSV' });
      await expect(source).toHaveAttribute(
        'href',
        'https://www.harp.lg.jp/opendata/dataset/1823.html',
      );
      await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
      await expect(page.getByText('일부 구간의 실제 경로를 확인하지 못했어요.')).toBeVisible();
      expect(
        (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items.map(
          (p: any) => p.id,
        ),
      ).toEqual([first.id, second.id]);
      await page.screenshot({ path: `/private/tmp/bookhaedo-tourism-${viewport.width}.png` });
      await page.getByLabel('관심 주제', { exact: true }).fill('박물관');
      await expect(page.getByRole('button', { name: '이 코스로 하루 교체' })).toHaveCount(0);
      await expect(page.getByText('추천 조건이 바뀌었어요.', { exact: false })).toBeVisible();
      await expect(page.locator('.day-plan-card')).toHaveCount(0);
      await page.getByRole('button', { name: '조건 적용해 다시 추천' }).click();
      await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
      await expect(page.getByRole('button', { name: '이 코스로 하루 교체' })).toBeVisible();
      await page.getByText('현재 일정에서 유지할 장소 선택', { exact: true }).click();
      await page
        .locator('.knowledge-controls')
        .getByRole('checkbox', { name: second.name, exact: true })
        .check();
      await expect(page.getByRole('button', { name: '이 코스로 하루 교체' })).toHaveCount(0);
      await expect(page.locator('.day-plan-card')).toHaveCount(0);
      await expect(page.getByText('추천 조건이 바뀌었어요.', { exact: false })).toBeVisible();
      expect(saveRequests).toBe(0);
      await page.screenshot({
        path: `/private/tmp/bookhaedo-tourism-conditions-${viewport.width}.png`,
      });
      expect(
        (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items.map(
          (p: any) => p.id,
        ),
      ).toEqual([first.id, second.id]);
      await page.getByRole('button', { name: '조건 적용해 다시 추천' }).click();
      await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
      expect(recommendationRequests.at(-1)).toMatchObject({
        strategy: 'KNOWLEDGE',
        interests: '박물관',
        keepPlaceIds: [second.id],
      });
      await expect(page.getByRole('button', { name: '이 코스로 하루 교체' })).toBeVisible();
      await page.screenshot({ path: `/private/tmp/bookhaedo-tourism-kept-${viewport.width}.png` });
      await page.getByRole('button', { name: '이 코스로 하루 교체' }).click();
      await expect(page.locator('.stop-name')).toHaveCount(3);
      expect(
        (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items.map(
          (p: any) => p.id,
        ),
      ).toEqual([second.id, first.id, additional[0].id]);
      expect(saveRequests).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
      await db.end();
    }
  });
}
