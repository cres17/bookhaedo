import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
for (const width of [1440, 390])
  test(`코스 확정 충돌과 저장 응답 유실 복구 (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    const email = randomUUID() + '@example.test';
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
    });
    let trip = '',
      writes = 0;
    let fault: 'conflict' | 'before' | 'after' | 'pending' | 'pending-success' = 'conflict';
    let releaseWrite: (() => void) | undefined;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      for (const [i, id] of ids.entries())
        await db.query(
          `INSERT INTO geo_data.place(id,region_id,category,name_ja,name_ko,normalized_name,latitude,longitude,location,region_distance_km,osm_tags) VALUES($1,'sapporo','ATTRACTION',$2,$2,$1,$3,141.35,ST_SetSRID(ST_MakePoint(141.35,$3),4326)::geography,0,'{"tourism":"museum"}')`,
          [id, '복구 시설 ' + i, 43.06 + i * 0.001],
        );
      expect(
        (
          await page.request.post('/api/auth/register', {
            data: { email, name: 'recovery', password: 'recovery-password' },
          })
        ).status(),
      ).toBe(201);
      const created = await page.request.post('/api/trips', {
        data: { title: '코스 저장 복구', startDate: '2026-10-10', days: 2, transportMode: 'WALK' },
      });
      expect(created.status()).toBe(201);
      trip = (await created.json()).data.id;
      const base = `/api/trips/${trip}/days/2026-10-10`;
      expect(
        (
          await page.request.put(base + '/items', {
            data: { placeIds: ids.slice(0, 2), expectedRevision: 0 },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await page.request.put(`/api/trips/${trip}/days/2026-10-11/items`, {
            data: { placeIds: ids.slice(0, 2), expectedRevision: 0 },
          })
        ).status(),
      ).toBe(200);
      const places = (
        await db.query(
          `SELECT id,name_ko AS name,name_ja AS "nameJa",category,region_id AS "regionId",latitude,longitude,osm_tags AS tags FROM geo_data.place WHERE id=ANY($1::text[]) ORDER BY array_position($1::text[],id)`,
          [ids],
        )
      ).rows;
      const plan = {
        id: 'NEARBY',
        label: '복구 검증 코스',
        reason: '화면 검증 자료',
        places: places.slice(2),
        distanceMeters: 2000,
      };
      await page.route('https://maps.googleapis.com/**', (r) => r.abort());
      await page.route('**/api/weather?*', (r) => r.fulfill({ json: { available: false } }));
      await page.route('**/routes', (r) => r.fulfill({ json: { segments: [] } }));
      await page.route('**/day-alternatives*', async (r) => {
        if (r.request().method() === 'PATCH') {
          writes++;
          if (fault === 'conflict')
            return r.fulfill({
              status: 409,
              json: { error: '문맥 변경', code: 'RECOMMENDATION_CONTEXT_CHANGED' },
            });
          if (fault === 'pending' || fault === 'pending-success')
            await new Promise<void>((resolve) => {
              releaseWrite = resolve;
            });
          if (fault === 'pending-success') {
            const response = await r.fetch();
            expect(response.status()).toBe(200);
            return r.fulfill({ response });
          }
          if (fault === 'after') expect((await r.fetch()).status()).toBe(200);
          return r.abort('failed');
        }
        const current = (await (await page.request.get('/api/trips/' + trip)).json()).data;
        const url = new URL(r.request().url());
        const date = url.pathname.split('/days/')[1]!.split('/')[0]!;
        const day = current.days.find((d: any) => d.date === date);
        const selected = url.searchParams.get('strategy');
        return r.fulfill({
          json: {
            tripId: trip,
            date,
            transportMode: current.transportMode,
            expectedRevision: day.revision,
            expectedPlaceIds: day.items.map((p: any) => p.id),
            weather: { available: false },
            plans: [plan],
            preview: selected
              ? {
                  plan,
                  segments: [],
                  complete: true,
                  mode: current.transportMode,
                  distanceMeters: 2000,
                  durationSeconds: 600,
                }
              : null,
          },
        });
      });
      const ownerId = (await (await page.request.get('/api/auth/me')).json()).user.id;
      await page.addInitScript((id) => {
        (window as any).__recoveryOwner = id;
      }, ownerId);
      await page.goto('/trips/' + trip);
      const open = () => page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
      const select = () => page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
      const save = () =>
        page.getByRole('button', { name: '이 코스로 하루 교체', exact: true }).click();
      const panel = page.getByRole('region', { name: '하루 코스 추천', exact: true });
      await open();
      await select();
      await save();
      await expect(panel.getByRole('alert')).toContainText('최신 일정을 확인');
      await expect(
        panel.getByRole('button', { name: '이 코스로 하루 교체', exact: true }),
      ).toHaveCount(0);
      expect(writes).toBe(1);
      await panel.getByRole('button', { name: '다시 조회', exact: true }).click();
      await select();
      fault = 'before';
      await save();
      await expect(panel.getByRole('alert')).toContainText('저장 응답을 확인하지 못했어요');
      expect(writes).toBe(2);
      // Unknown outcomes survive unmount, refresh and transport-mode remounts.
      await panel.getByRole('button', { name: '하루 코스 추천 닫기', exact: true }).click();
      await page.getByRole('button', { name: '추천 숨기기', exact: true }).click();
      await page.getByRole('button', { name: '하루 코스 추천 켜기', exact: true }).click();
      await open();
      await expect(
        panel.getByRole('button', { name: '현재 일정 확인', exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole('button', { name: '이 코스 동선 미리보기' })).toHaveCount(0);
      await page.reload();
      await open();
      await expect(
        panel.getByRole('button', { name: '현재 일정 확인', exact: true }),
      ).toBeVisible();
      await panel.getByRole('button', { name: '하루 코스 추천 닫기', exact: true }).click();
      await page.getByRole('button', { name: '여행 설정', exact: true }).click();
      const settings = page.getByRole('dialog', { name: '여행 설정', exact: true });
      await settings.getByLabel('이동 방법').selectOption('BICYCLE');
      await settings.getByRole('button', { name: '저장하기', exact: true }).click();
      await expect(settings).toHaveCount(0);
      await open();
      await expect(
        panel.getByRole('button', { name: '현재 일정 확인', exact: true }),
      ).toBeVisible();
      // Recovery is scoped to the affected date, rather than blocking a different day.
      await page.locator('.day-tabs button').nth(1).click();
      await open();
      await select();
      await expect(panel.getByRole('button', { name: '현재 일정 확인', exact: true })).toHaveCount(
        0,
      );
      await panel.getByRole('button', { name: '하루 코스 추천 닫기', exact: true }).click();
      await page.locator('.day-tabs button').nth(0).click();
      await open();
      await expect(
        panel.getByRole('button', { name: '현재 일정 확인', exact: true }),
      ).toBeVisible();
      expect(writes).toBe(2);
      await panel.getByRole('button', { name: '현재 일정 확인', exact: true }).click();
      await expect(panel).toHaveCount(0);
      let current = (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0];
      expect(current.revision).toBe(1);
      expect(current.items.map((p: any) => p.id)).toEqual(ids.slice(0, 2));
      await open();
      await select();
      fault = 'after';
      await save();
      await expect(panel.getByRole('alert')).toContainText('저장 응답을 확인하지 못했어요');
      expect(writes).toBe(3);
      await panel.getByRole('button', { name: '현재 일정 확인', exact: true }).click();
      await expect(panel).toHaveCount(0);
      current = (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0];
      expect(current.revision).toBe(2);
      expect(current.items.map((p: any) => p.id)).toEqual(ids.slice(2));
      expect(writes).toBe(3);
      // A late failed response belongs to the original day even if its panel is gone.
      await open();
      await select();
      fault = 'pending';
      await save();
      await expect.poll(() => !!releaseWrite).toBe(true);
      await page.locator('.day-tabs button').nth(1).click();
      await open();
      await select();
      releaseWrite?.();
      releaseWrite = undefined;
      await expect
        .poll(() =>
          page.evaluate(() =>
            sessionStorage.getItem(
              'bookhaedo-course-recovery:v1:' + (window as any).__recoveryOwner,
            ),
          ),
        )
        .toBeTruthy();
      await expect(panel.getByRole('button', { name: '현재 일정 확인', exact: true })).toHaveCount(
        0,
      );
      await panel.getByRole('button', { name: '하루 코스 추천 닫기', exact: true }).click();
      await page.locator('.day-tabs button').nth(0).click();
      await open();
      await expect(
        panel.getByRole('button', { name: '현재 일정 확인', exact: true }),
      ).toBeVisible();
      await panel.getByRole('button', { name: '현재 일정 확인', exact: true }).click();
      await expect(panel).toHaveCount(0);
      expect(writes).toBe(4);
      // A known success on a no-longer-visible day still refreshes this trip.
      await page.locator('.day-tabs button').nth(1).click();
      await open();
      await select();
      fault = 'pending-success';
      await save();
      await expect.poll(() => !!releaseWrite).toBe(true);
      await page.locator('.day-tabs button').nth(0).click();
      releaseWrite?.();
      releaseWrite = undefined;
      await expect(page.getByText('새로운 하루 코스를 저장했어요.', { exact: true })).toBeVisible();
      await page.locator('.day-tabs button').nth(1).click();
      await expect(page.locator('.itinerary-stop .stop-name')).toHaveText([
        '복구 시설 2',
        '복구 시설 3',
        '복구 시설 4',
      ]);
      current = (await (await page.request.get('/api/trips/' + trip)).json()).data.days[1];
      expect(current.revision).toBe(2);
      expect(writes).toBe(5);
      expect(errors).toEqual([]);
    } finally {
      releaseWrite?.();
      await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
      await db.query('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [ids]);
      await db.end();
    }
  });
