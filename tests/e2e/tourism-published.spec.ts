import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

// Opt-in: requires already published HARP records and real provider services.
test.skip(process.env.TOURISM_PUBLISHED_E2E !== '1', '실제 HARP 적재 후 명시적으로 실행');
for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`실제 발행 자료 추천·미리보기·저장 (${viewport.width}px)`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize(viewport);
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const email = `tourism-published-${randomUUID()}@example.test`;
    const date = '2026-11-01';
    try {
      const first = (
        await db.query(
          `SELECT p.id,COALESCE(p.name_ko,p.name_ja) AS name,r.title_ja AS title,r.resource_url AS "resourceUrl",r.snapshot_id AS "snapshotId",p.latitude,p.longitude FROM tourism_knowledge.record r JOIN tourism_knowledge.source s ON s.active_snapshot_id=r.snapshot_id JOIN geo_data.place p ON p.id=r.canonical_place_id WHERE s.id='furano-places' AND s.enabled AND s.rights_status='approved' AND r.external_id='TR0000000001' AND r.hours_status='historical' AND r.date_status='tentative'`,
        )
      ).rows[0];
      expect(first, '실제 五郎の石の家 자료가 발행되어야 합니다').toBeTruthy();
      const second = (
        await db.query(
          `SELECT id FROM geo_data.place WHERE region_id='furano' AND id<>$1 AND category<>'LODGING' AND COALESCE(osm_tags->>'access','') NOT IN ('private','no') AND COALESCE(osm_tags->>'disused','')<>'yes' AND COALESCE(osm_tags->>'abandoned','')<>'yes' AND COALESCE(opening_hours,'')<>'closed' AND COALESCE(osm_tags->>'opening_hours','')<>'closed' AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,20000) ORDER BY location <-> ST_SetSRID(ST_MakePoint($2,$3),4326)::geography LIMIT 1`,
          [first.id, first.longitude, first.latitude],
        )
      ).rows[0];
      expect(second).toBeTruthy();
      const registered = await page.request.post('/api/auth/register', {
        data: { email, name: '실제 자료 검증', password: 'tourism-published-password' },
      });
      expect(registered.status(), await registered.text()).toBe(201);
      const create = await page.request.post('/api/trips', {
        data: { title: '실제 관광 자료 검증', startDate: date, days: 1, transportMode: 'WALK' },
      });
      expect(create.status(), await create.text()).toBe(201);
      const trip = (await create.json()).data.id;
      const initial = [first.id, second.id];
      expect(
        (
          await page.request.put(`/api/trips/${trip}/days/${date}/items`, {
            data: { placeIds: initial, expectedRevision: 0 },
          })
        ).ok(),
      ).toBe(true);
      await page.goto('/trips/' + trip);
      await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
      await page.getByRole('checkbox', { name: '공개 관광 자료 함께 보기' }).check();
      await expect(page.getByRole('heading', { name: '함께 확인한 공개 자료' })).toBeVisible({
        timeout: 30000,
      });
      await page.getByText('현재 일정에서 유지할 장소 선택', { exact: true }).click();
      await page
        .locator('.knowledge-controls')
        .getByRole('checkbox', { name: first.name, exact: true })
        .check();
      const pending = page.waitForResponse(
        (r) => r.url().endsWith('/ai-recommendations') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '조건 적용해 다시 추천' }).click();
      const response = await pending;
      expect(response.ok()).toBe(true);
      const result = await response.json();
      expect(result.status).toBe('READY');
      const facility = result.evidence.find((e: any) => e.placeId === first.id);
      expect(facility.snapshotId).toBe(first.snapshotId);
      const detail = page
        .locator('.tourism-evidence details')
        .filter({ has: page.locator('summary', { hasText: first.title }) });
      await detail.locator('summary').click();
      await expect(detail.getByText('과거 영업시간 포함', { exact: false })).toBeVisible();
      await expect(detail.getByText('개최 미확정 · 변경 가능')).toHaveCount(0);
      await expect(detail.getByRole('link', { name: '富良野市 원문 CSV' })).toHaveAttribute(
        'href',
        first.resourceUrl,
      );
      await expect(detail.getByRole('link', { name: 'CC-BY-4.0' })).toHaveAttribute(
        'href',
        'https://creativecommons.org/licenses/by/4.0/',
      );
      const card = page
        .locator('.day-plan-card')
        .filter({ has: page.getByRole('heading', { name: '공개 자료를 참고한 코스' }) });
      const previewPending = page.waitForResponse(
        (r) =>
          r.url().endsWith('/ai-recommendations') &&
          r.request().postDataJSON()?.strategy === 'KNOWLEDGE',
      );
      await card.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
      const previewResponse = await previewPending;
      expect(previewResponse.ok()).toBe(true);
      const previewResult = await previewResponse.json();
      const preview = previewResult.preview;
      expect(preview.plan.places[0].id).toBe(first.id);
      if (preview.complete) {
        expect(Number.isFinite(preview.distanceMeters)).toBe(true);
        expect(Number.isFinite(preview.durationSeconds)).toBe(true);
        expect(preview.segments.every((s: any) => ['valhalla', 'google'].includes(s.source))).toBe(
          true,
        );
        await expect(page.getByText('실제 경로', { exact: false }).last()).toBeVisible();
      } else {
        expect(preview.distanceMeters).toBeNull();
        expect(preview.durationSeconds).toBeNull();
        await expect(
          page.getByText('일부 구간의 실제 경로를 확인하지 못했어요.', { exact: false }),
        ).toBeVisible();
      }
      const readItems = async () =>
        (await (await page.request.get('/api/trips/' + trip)).json()).data.days[0].items.map(
          (p: any) => p.id,
        );
      expect(await readItems()).toEqual(initial);
      const output = process.env.TOURISM_E2E_OUTPUT;
      if (output) {
        await page.locator('.day-preview').scrollIntoViewIfNeeded();
        await mkdir(output, { recursive: true });
        await page.screenshot({
          path: join(output, `published-${viewport.width}.png`),
          fullPage: false,
        });
      }
      if (output) {
        const actualDetail = page
          .locator('.tourism-evidence details')
          .filter({ has: page.locator('summary', { hasText: first.title }) });
        if ((await actualDetail.getAttribute('open')) === null)
          await actualDetail.locator('summary').click();
        await actualDetail.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, `published-evidence-${viewport.width}.png`) });
      }
      expect(errors).toEqual([]);
      await page.getByRole('button', { name: '이 코스로 하루 교체' }).click();
      await expect(page.locator('.stop-name')).toHaveCount(preview.plan.places.length);
      const saved = await readItems();
      expect(saved).toEqual(preview.plan.places.map((p: any) => p.id));
      if (output)
        await writeFile(
          join(output, `ui-${viewport.width}.json`),
          JSON.stringify(
            {
              viewport,
              date,
              status: previewResult.status,
              searchAttempts: previewResult.searchAttempts,
              evidenceIds: preview.plan.evidenceIds,
              snapshotIds: previewResult.snapshotIds,
              keptPlaceId: first.id,
              previewPlaceIds: preview.plan.places.map((p: any) => p.id),
              complete: preview.complete,
              distanceMeters: preview.distanceMeters,
              durationSeconds: preview.durationSeconds,
              segmentSources: preview.segments.map((s: any) => s.source),
              confirmedPlaceIds: saved,
            },
            null,
            2,
          ) + '\n',
        );
    } finally {
      await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
      await db.end();
    }
  });
}

for (const width of [1440, 390]) {
  test(`실제 삿포로 발행 자료의 추천·출처 (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
    });
    const email = `sapporo-published-${randomUUID()}@example.test`;
    const date = '2026-11-01';
    try {
      const first = (
        await db.query(`SELECT p.id,COALESCE(p.name_ko,p.name_ja) AS name,r.title_ja AS title,r.resource_url AS "resourceUrl",r.snapshot_id AS "snapshotId"
      FROM tourism_knowledge.record r JOIN tourism_knowledge.source s ON s.active_snapshot_id=r.snapshot_id JOIN geo_data.place p ON p.id=r.canonical_place_id
      WHERE s.id='sapporo-places' AND s.enabled AND s.rights_status='approved' AND p.category<>'LODGING' ORDER BY r.external_id LIMIT 1`)
      ).rows[0];
      expect(first, '실제 삿포로 발행 시설 필요').toBeTruthy();
      const registered = await page.request.post('/api/auth/register', {
        data: { email, name: '삿포로 자료 검증', password: 'sapporo-test-password' },
      });
      expect(registered.status(), await registered.text()).toBe(201);
      const created = await page.request.post('/api/trips', {
        data: { title: '삿포로 자료 검증', startDate: date, days: 1, transportMode: 'WALK' },
      });
      expect(created.status(), await created.text()).toBe(201);
      const trip = (await created.json()).data.id;
      expect(
        (
          await page.request.put(`/api/trips/${trip}/days/${date}/items`, {
            data: { placeIds: [first.id], expectedRevision: 0 },
          })
        ).ok(),
      ).toBe(true);
      const response = await page.request.post(
        `/api/trips/${trip}/days/${date}/ai-recommendations`,
        { data: { count: 4, keepPlaceIds: [first.id] } },
      );
      expect(response.ok()).toBe(true);
      const result = await response.json();
      expect(result.status).toBe('READY');
      expect(result.evidence.find((e: any) => e.placeId === first.id)).toMatchObject({
        sourceId: 'sapporo-places',
        snapshotId: first.snapshotId,
        publisher: '札幌市',
        licenseId: 'CC-BY-4.0',
        resourceUrl: first.resourceUrl,
        hoursStatus: 'unknown',
        scheduleRaw: '',
        excerpt: '',
      });
      await page.goto('/trips/' + trip);
      await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
      await page.getByRole('checkbox', { name: '공개 관광 자료 함께 보기' }).check();
      await page.getByText('현재 일정에서 유지할 장소 선택', { exact: true }).click();
      await page
        .locator('.knowledge-controls')
        .getByRole('checkbox', { name: first.name, exact: true })
        .check();
      await page.getByRole('button', { name: '조건 적용해 다시 추천' }).click();
      const detail = page
        .locator('.tourism-evidence details')
        .filter({ has: page.locator('summary', { hasText: first.title }) });
      await expect(detail).toBeVisible();
      await detail.locator('summary').click();
      await expect(detail.getByRole('link', { name: '札幌市 원문 CSV' })).toHaveAttribute(
        'href',
        first.resourceUrl,
      );
      await expect(detail.getByRole('link', { name: 'CC-BY-4.0' })).toHaveAttribute(
        'href',
        'https://creativecommons.org/licenses/by/4.0/',
      );
      await expect(detail.getByText('과거 영업시간 포함', { exact: false })).toHaveCount(0);
      const saved = (
        await (await page.request.get('/api/trips/' + trip)).json()
      ).data.days[0].items.map((p: any) => p.id);
      expect(saved).toEqual([first.id]);
    } finally {
      await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
      await db.end();
    }
  });
}
