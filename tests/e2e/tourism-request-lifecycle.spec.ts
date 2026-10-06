import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
for (const width of [1440, 390])
  test(`추천 조회 취소·날짜 변경·대중교통 독립 시간 비교 (${width}px)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    const email = 'lifecycle-' + randomUUID() + '@example.test';
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let release: (() => void) | undefined;
    try {
      for (const [i, id] of ids.entries())
        await db.query(
          `INSERT INTO geo_data.place(id,region_id,category,name_ja,name_ko,normalized_name,latitude,longitude,location,region_distance_km,osm_tags) VALUES($1,'sapporo','ATTRACTION',$2,$2,$1,$3,141.35,ST_SetSRID(ST_MakePoint(141.35,$3),4326)::geography,0,'{"tourism":"museum"}')`,
          [id, '취소 검증 시설 ' + i, 43.06 + i * 0.001],
        );
      const places = (
        await db.query(
          `SELECT id,name_ko AS name,name_ja AS "nameJa",category,latitude,longitude,osm_tags AS tags FROM geo_data.place WHERE id=ANY($1::text[]) ORDER BY array_position($1::text[],id)`,
          [ids],
        )
      ).rows;
      expect(
        (
          await page.request.post('/api/auth/register', {
            data: { email, name: 'lifecycle', password: 'lifecycle-password' },
          })
        ).status(),
      ).toBe(201);
      const created = await page.request.post('/api/trips', {
        data: {
          title: '조회 취소 검증',
          startDate: '2026-10-10',
          days: 2,
          transportMode: 'TRANSIT',
        },
      });
      expect(created.status()).toBe(201);
      const trip = (await created.json()).data.id;
      for (const date of ['2026-10-10', '2026-10-11'])
        expect(
          (
            await page.request.put(`/api/trips/${trip}/days/${date}/items`, {
              data: { placeIds: ids.slice(0, 2), expectedRevision: 0 },
            })
          ).status(),
        ).toBe(200);
      await page.addInitScript(() => {
        const records: any[] = [];
        (window as any).__recommendationReads = records;
        const original = window.fetch;
        window.fetch = function (input, options) {
          const url = String(input);
          if (/\/(ai-recommendations|day-alternatives)/.test(url) && options?.method !== 'PATCH') {
            const record = { url, hasSignal: !!options?.signal, aborted: false };
            records.push(record);
            options?.signal?.addEventListener('abort', () => (record.aborted = true), {
              once: true,
            });
          }
          return original.call(this, input, options);
        };
      });
      await page.route('https://maps.googleapis.com/**', (r) => r.abort());
      await page.route('**/api/weather?*', (r) => r.fulfill({ json: { available: false } }));
      await page.route('**/routes', (r) => r.fulfill({ json: { segments: [] } }));
      let delay = false;
      const plan = {
        id: 'NEARBY',
        label: '구간별 비교 코스',
        reason: '화면 검증 자료',
        places: places.slice(2),
        distanceMeters: 2000,
      };
      await page.route(
        /\/api\/trips\/[^/]+\/days\/[^/]+\/(day-alternatives|ai-recommendations)/,
        async (r) => {
          if (r.request().method() === 'PATCH') return r.continue();
          const url = new URL(r.request().url());
          const body = r.request().method() === 'POST' ? r.request().postDataJSON() : {};
          const date = url.pathname.split('/')[5];
          const selected = body.strategy || url.searchParams.get('strategy');
          if (delay) {
            delay = false;
            await new Promise<void>((resolve) => (release = resolve));
            release = undefined;
          }
          await r
            .fulfill({
              json: {
                tripId: trip,
                date,
                transportMode: 'TRANSIT',
                expectedRevision: 1,
                expectedPlaceIds: ids.slice(0, 2),
                weather: { available: false },
                plans: [plan],
                evidence: [],
                referenceEvents: [],
                preview: selected
                  ? {
                      plan,
                      segments: places.slice(3).map((p, i) => ({
                        from: places[i + 2].id,
                        to: p.id,
                        source: 'google',
                        distanceMeters: 1000,
                        durationSeconds: 1800,
                      })),
                      complete: true,
                      mode: 'TRANSIT',
                      timelineStatus: 'NOT_EVALUATED',
                      departureNotice: `각 구간은 ${date} 오전 9시(JST) 출발을 독립적으로 비교합니다. 장소 체류시간과 구간 사이의 시간 연결은 검증하지 않았어요.`,
                      distanceMeters: 2000,
                      durationSeconds: null,
                    }
                  : null,
              },
            })
            .catch(() => {});
        },
      );
      const aborted = () =>
        page.evaluate(
          () => (window as any).__recommendationReads.filter((r: any) => r.aborted).length,
        );
      await page.goto('/trips/' + trip);
      await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
      await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
      const preview = page.getByRole('region', { name: '하루 코스 변경 미리보기' });
      await expect(preview.getByText(/각 구간은/)).toBeVisible();
      await expect(
        preview.getByRole('list', { name: '대중교통 구간별 비교 시간' }).getByRole('listitem'),
      ).toHaveCount(2);
      await expect(preview).not.toContainText('60분');
      await expect(preview).toContainText('30분');
      await preview.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('independent-transit.png') });
      delay = true;
      await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
      await expect.poll(() => !!release).toBe(true);
      const count = await aborted();
      await page.getByRole('button', { name: '하루 코스 추천 닫기' }).click();
      await expect.poll(aborted).toBe(count + 1);
      release?.();
      await expect(page.locator('.day-plan-panel')).toHaveCount(0);
      await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
      await page.getByRole('checkbox', { name: '공개 관광 자료 함께 보기' }).check();
      delay = true;
      await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
      await expect.poll(() => !!release).toBe(true);
      const before = await aborted();
      await page.locator('.day-tabs button').nth(1).click();
      await expect.poll(aborted).toBe(before + 1);
      release?.();
      await expect(page.locator('.day-plan-panel')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      const saved = (await (await page.request.get('/api/trips/' + trip)).json()).data;
      expect(
        saved.days.every(
          (d: any) =>
            d.revision === 1 &&
            JSON.stringify(d.items.map((p: any) => p.id)) === JSON.stringify(ids.slice(0, 2)),
        ),
      ).toBe(true);
      expect(
        await page.evaluate(() =>
          (window as any).__recommendationReads.every((r: any) => r.hasSignal),
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      release?.();
      await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
      await db.query('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [ids]);
      await db.end();
    }
  });
