import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
test.skip(process.env.TOURISM_PUBLISHED_E2E !== '1', '실제 북토시 CSV 발행 후 실행');
for (const width of [1440, 390]) {
  test(`북토시 실제 자료의 추천·출처·경로·저장 (${width}px)`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
    });
    const email = `expanded-${randomUUID()}@example.test`,
      date = '2026-11-01';
    try {
      const facilities = (
        await db.query(
          `SELECT r.external_id AS "externalId",r.title_ja AS title,r.resource_url AS "resourceUrl",r.snapshot_id AS "snapshotId",p.id,COALESCE(p.name_ko,p.name_ja) AS name FROM tourism_knowledge.record r JOIN tourism_knowledge.source s ON s.active_snapshot_id=r.snapshot_id JOIN geo_data.place p ON p.id=r.canonical_place_id WHERE s.id='hokuto-places' AND s.enabled AND s.rights_status='approved' ORDER BY r.external_id`,
        )
      ).rows;
      expect(facilities.length).toBeGreaterThanOrEqual(2);
      const registered = await page.request.post('/api/auth/register', {
        data: { email, name: '북토시 실제 자료 검증', password: 'expanded-test-password' },
      });
      expect(registered.status(), await registered.text()).toBe(201);
      const created = await page.request.post('/api/trips', {
        data: { title: '북토시 자료 검증', startDate: date, days: 1, transportMode: 'WALK' },
      });
      expect(created.status(), await created.text()).toBe(201);
      const trip = (await created.json()).data.id,
        base = `/api/trips/${trip}/days/${date}`,
        ids = facilities.slice(0, 2).map((p) => p.id);
      expect(
        (
          await page.request.put(base + '/items', { data: { placeIds: ids, expectedRevision: 0 } })
        ).status(),
      ).toBe(200);
      const initial = await page.request.post(base + '/ai-recommendations', {
        data: { count: 3, keepPlaceIds: ids, strategy: 'KNOWLEDGE' },
      });
      expect(initial.status(), await initial.text()).toBe(200);
      const result = await initial.json();
      expect(result.status).toBe('READY');
      expect(
        result.evidence.some(
          (e: any) => e.sourceId === 'hokuto-places' && e.snapshotId === facilities[0].snapshotId,
        ),
      ).toBe(true);
      expect(result.referenceEvents).toEqual([]);
      expect(result.preview.plan.places.slice(0, 2).map((p: any) => p.id)).toEqual(ids);
      if (process.env.VALHALLA_BASE_URL?.startsWith('http://127.0.0.1:')) {
        expect(result.preview.complete).toBe(true);
        expect(
          result.preview.segments.every(
            (s: any) => s.source === 'valhalla' && Number.isFinite(s.durationSeconds),
          ),
        ).toBe(true);
      }
      await page.route('https://maps.googleapis.com/**', (r) => r.abort());
      await page.goto('/trips/' + trip);
      await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
      await page.getByRole('checkbox', { name: '공개 관광 자료 함께 보기' }).check();
      // Both linked facilities already belong to this trip. Keep one explicitly before asking for evidence.
      await page.getByText('현재 일정에서 유지할 장소 선택', { exact: true }).click();
      await page
        .locator('.knowledge-controls')
        .getByRole('checkbox', { name: facilities[0].name, exact: true })
        .check();
      const pending = page.waitForResponse((r) => r.url().endsWith('/ai-recommendations'));
      await page.getByRole('button', { name: '조건 적용해 다시 추천' }).click();
      expect((await pending).status()).toBe(200);
      await expect(page.getByRole('heading', { name: '함께 확인한 공개 자료' })).toBeVisible({
        timeout: 30000,
      });
      const detail = page
        .locator('.tourism-evidence details')
        .filter({ has: page.locator('summary', { hasText: facilities[0].title }) });
      await detail.locator('summary').click();
      await expect(detail.getByRole('link', { name: '北斗市 원문 CSV' })).toHaveAttribute(
        'href',
        facilities[0].resourceUrl,
      );
      await expect(detail.getByRole('link', { name: 'CC-BY-4.0' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '일정 확인이 필요한 행사' })).toHaveCount(0);
      await detail.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('hokuto-published.png') });
      const saved = await page.request.patch(base + '/day-alternatives', {
        data: {
          placeIds: result.preview.plan.places.map((p: any) => p.id),
          expectedPlaceIds: ids,
          expectedRevision: result.expectedRevision,
        },
      });
      expect(saved.status(), await saved.text()).toBe(200);
      const after = (
        await (await page.request.get('/api/trips/' + trip)).json()
      ).data.days[0].items.map((p: any) => p.id);
      expect(after).toEqual(result.preview.plan.places.map((p: any) => p.id));
    } finally {
      await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
      await db.end();
    }
  });
}
