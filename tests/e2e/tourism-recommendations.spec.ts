import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`공개 관광 자료 출처·미확정 표시와 확정 저장 (${viewport.width}px)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const email = `tourism-ui-${randomUUID()}@example.test`;
    const fixtureIds = Array.from({ length: 5 }, () => randomUUID());
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      // Seed only this test's synthetic places; no imported catalog or HARP data is required.
      for (const [index, id] of fixtureIds.entries()) {
        await db.query(
          `INSERT INTO geo_data.place(id,region_id,category,name_ja,name_ko,normalized_name,latitude,longitude,location,region_distance_km,osm_tags)
          VALUES($1,'sapporo','ATTRACTION',$2,$3,$1,$4,141.35,ST_SetSRID(ST_MakePoint(141.35,$4),4326)::geography,0,'{"tourism":"museum"}')`,
          [
            id,
            `観光テスト博物館 ${index + 1}`,
            `관광 테스트 박물관 ${index + 1}`,
            43.06 + index * 0.001,
          ],
        );
      }
      const places = (
        await db.query(
          `SELECT id,COALESCE(name_ko,name_ja) AS name,name_ja AS "nameJa",category,latitude,longitude,osm_tags AS tags
        FROM geo_data.place WHERE id=ANY($1::text[]) ORDER BY array_position($1::text[],id)`,
          [fixtureIds],
        )
      ).rows;
      expect(places).toHaveLength(5);
      const [first, second, ...additional] = places;
      const registered = await page.request.post('/api/auth/register', {
        data: { email, name: '관광 추천 UI', password: 'tourism-ui-password' },
      });
      expect(registered.status(), await registered.text()).toBe(201);
      const created = await page.request.post('/api/trips', {
        data: { title: '공개 관광 자료 검증', startDate: '2026-10-01', days: 1 },
      });
      expect(created.status(), await created.text()).toBe(201);
      const trip = (await created.json()).data.id;
      const base = `/api/trips/${trip}/days/2026-10-01`;
      const initialItems = await page.request.put(base + '/items', {
        data: { placeIds: [first.id, second.id], expectedRevision: 0 },
      });
      expect(initialItems.status(), await initialItems.text()).toBe(200);
      const plan = {
        id: 'KNOWLEDGE',
        label: '공개 자료를 참고한 코스',
        reason: '출처를 확인하고 적용해요.',
        places: [first, ...additional.slice(0, 2)],
        distanceMeters: 1000,
        evidenceIds: ['facility'],
      };
      let previewFailure: number | 'network' | null = null;
      let saveRequests = 0;
      let useRealLimiter = false;
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
        if (useRealLimiter) {
          useRealLimiter = false;
          return r.continue();
        }
        if (body.strategy && previewFailure) {
          const failure = previewFailure;
          previewFailure = null;
          if (failure === 'network') return r.abort('failed');
          return r.fulfill({ status: failure, json: { error: `미리보기 실패 ${failure}` } });
        }
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
            referenceEvents: ['recurring', 'unknown'].map((dateStatus) => ({
              id: 'reference-' + dateStatus,
              kind: 'event',
              placeId: null,
              dateStatus,
              title: dateStatus === 'recurring' ? '반복 행사 자료' : '날짜 없는 행사 자료',
              excerpt: '과거 소개일 수 있는 CSV',
              scheduleRaw: '매년 7월 (원문 표현)',
              publisher: '富良野市',
              resourceUrl: 'https://www.harp.lg.jp/opendata/dataset/2208.html',
              licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
              licenseId: 'CC-BY-4.0',
              fetchedAt: '2026-10-01T00:00:00Z',
              sourceUpdatedAt: null,
            })),
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
                dateStatus: 'tentative',
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
              {
                id: 'dated-event',
                kind: 'event',
                placeId: null,
                title: '期間が記載された行事',
                excerpt: '日付あり',
                publisher: '富良野市',
                resourceUrl: 'https://www.harp.lg.jp/opendata/dataset/2208.html',
                licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
                licenseId: 'CC-BY-4.0',
                fetchedAt: '2026-10-01T00:00:00Z',
                startDate: '2026-10-01',
                endDate: '2026-10-02',
                dateStatus: 'confirmed',
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
      await expect(page.getByText('개최 미확정 · 변경 가능')).not.toBeVisible();
      await page.getByText('행사 참고 자료 · 행사 참고', { exact: true }).click();
      await expect(page.getByText('개최 미확정 · 변경 가능')).toBeVisible();
      await expect(page.getByText('자료에 좌표 없음')).toBeVisible();
      await page.getByText('期間が記載された行事 · 행사 참고', { exact: true }).click();
      await expect(
        page.getByText('자료에 시작·종료일 기재 · 개최 확정 여부는 원문 확인'),
      ).toBeVisible();
      const reference = page.getByRole('region', { name: '지역 행사 참고 목록' });
      await expect(
        reference.getByRole('heading', { name: '일정 확인이 필요한 행사' }),
      ).toBeVisible();
      await expect(reference.getByText(/여행일에 열리는지 확인한 정보가 아니며/)).toBeVisible();
      const summary = reference.locator('summary').first();
      await summary.focus();
      await summary.press('Enter');
      await expect(reference.getByText(/올해 개최 여부·정확한 날짜·장소/).first()).toBeVisible();
      await expect(reference.locator('button')).toHaveCount(0);
      expect(saveRequests).toBe(0);
      expect(await reference.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await reference.locator('h3').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('tourism-reference.png') });
      expect(await page.evaluate(() => !!(window as any).__tourismInjected)).toBe(false);
      const source = page.getByRole('link', { name: '恵庭市 원문 CSV' });
      await expect(source).toHaveAttribute(
        'href',
        'https://www.harp.lg.jp/opendata/dataset/1823.html',
      );
      for (const failure of [409, 429, 'network'] as const) {
        previewFailure = failure;
        await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.locator('.day-plan-card')).toHaveCount(1);
        await expect(page.getByRole('button', { name: '이 코스로 하루 교체' })).toHaveCount(0);
        expect(saveRequests).toBe(0);
        await page.getByRole('button', { name: '다시 조회', exact: true }).click();
        await expect(page.getByRole('button', { name: '이 코스로 하루 교체' })).toBeVisible();
      }
      await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
      await expect(page.getByText('일부 구간의 실제 경로를 확인하지 못했어요.')).toBeVisible();
      expect(
        (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items.map(
          (p: any) => p.id,
        ),
      ).toEqual([first.id, second.id]);
      await page.screenshot({ path: testInfo.outputPath('tourism-evidence.png') });
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
        path: testInfo.outputPath('tourism-conditions.png'),
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
      // Cards and provider responses above are fixtures. This 429 comes from the real POST limiter.
      const emptyTripResponse = await page.request.post('/api/trips', {
        data: { title: '실제 호출 제한 검증', startDate: '2026-10-01', days: 1 },
      });
      expect(emptyTripResponse.status()).toBe(201);
      const emptyTrip = (await emptyTripResponse.json()).data.id;
      for (let i = 0; i < 30; i++) {
        const warmup = await page.request.post(
          `/api/trips/${emptyTrip}/days/2026-10-01/ai-recommendations`,
          { data: {} },
        );
        expect(warmup.status()).toBe(200);
        expect((await warmup.json()).status).toBe('NEEDS_ANCHOR');
      }
      useRealLimiter = true;
      const blockedResponse = page.waitForResponse((response) =>
        response.url().endsWith(base + '/ai-recommendations'),
      );
      await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
      const blocked = await blockedResponse;
      expect(blocked.status()).toBe(429);
      expect((await blocked.json()).code).toBe('AI_RECOMMENDATION_RATE_LIMITED');
      expect(Number(blocked.headers()['retry-after'])).toBeGreaterThan(0);
      await expect(page.getByRole('alert')).toContainText(
        '추천 요청이 많아요. 잠시 후 다시 조회해주세요.',
      );
      await expect(page.locator('.day-plan-card')).toHaveCount(1);
      await expect(page.getByRole('button', { name: '이 코스로 하루 교체' })).toHaveCount(0);
      expect(saveRequests).toBe(0);
      expect(
        (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items.map(
          (p: any) => p.id,
        ),
      ).toEqual([first.id, second.id]);
      await page.screenshot({
        path: testInfo.outputPath('tourism-real-429.png'),
      });
      // Resume fixture previews so the existing confirmation test remains independent of wall time.
      await page.getByRole('button', { name: '다시 조회', exact: true }).click();
      await expect(page.getByRole('button', { name: '이 코스로 하루 교체' })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('tourism-kept.png') });
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
      try {
        await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
        await db.query('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [fixtureIds]);
      } finally {
        await db.end();
      }
    }
  });
}
