import { test, expect, type Page, type Route } from '@playwright/test';
const tid = '11111111-1111-4111-8111-111111111111',
  tid2 = '22222222-2222-4222-8222-222222222222';
const dates = ['2026-09-10', '2026-09-11'];
const place = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `검토 장소 ${n}`,
  nameJa: `検証${n}`,
  category: 'ATTRACTION',
  latitude: 43.06 + n * 0.001,
  longitude: 141.35,
  tags: { tourism: 'museum' },
  regionId: 'sapporo',
  note: '',
  sources: [],
});
const old = [place(1), place(2)],
  next = [place(3), place(4), place(5)];
const trip = {
  id: tid,
  title: '전환 검토',
  transportMode: 'DRIVE',
  costSettings: {},
  days: dates.map((date, i) => ({ id: `day-${i}`, date, revision: 0, items: old })),
};
const weather = {
  available: true,
  date: dates[0],
  description: '맑음',
  high: 22,
  low: 13,
  source: '테스트 예보',
};
async function mocks(
  page: Page,
  handler: (r: Route, u: URL) => Promise<void>,
  delayRoutes = false,
) {
  await page.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== '127.0.0.1') return r.abort();
    if (!u.pathname.startsWith('/api/')) return r.continue();
    if (u.pathname === '/api/auth/me')
      return r.fulfill({
        json: { user: { id: 'test', name: '검토', role: 'MEMBER', status: 'ACTIVE' } },
      });
    if (u.pathname === '/api/regions') return r.fulfill({ json: { data: [] } });
    if (u.pathname === '/api/weather') return r.fulfill({ json: weather });
    if (u.pathname.endsWith('/routes')) {
      if (delayRoutes) return;
      return r.fulfill({ json: { segments: [] } });
    }
    return handler(r, u);
  });
}
test('날짜를 바꾸면 이전 하루 추천을 닫고 확정할 수 없다', async ({ page }) => {
  let writes = 0;
  const plan = {
    id: 'NEARBY',
    label: '가까운 곳 중심 코스',
    places: next,
    distanceMeters: 2000,
    reason: '테스트',
  };
  await mocks(page, async (r, u) => {
    if (u.pathname.endsWith('/day-alternatives')) {
      if (r.request().method() === 'PATCH') {
        writes++;
        return r.fulfill({ json: { saved: true } });
      }
      return r.fulfill({
        json: {
          tripId: tid,
          date: dates[0],
          expectedRevision: 0,
          status: 'READY',
          weather,
          plans: [plan],
          expectedPlaceIds: old.map((p) => p.id),
          preview: u.searchParams.has('strategy')
            ? { plan, segments: [], complete: true, distanceMeters: 2000, durationSeconds: 600 }
            : null,
        },
      });
    }
    return r.fulfill({ json: { data: trip } });
  });
  await page.goto('/trips/' + tid);
  await page.getByRole('button', { name: '하루 코스 추천', exact: true }).click();
  await page.getByRole('button', { name: '이 코스 동선 미리보기' }).click();
  await expect(
    page.getByRole('button', { name: '이 코스로 하루 교체', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /DAY 02/ }).click();
  await expect(page.getByRole('region', { name: '하루 코스 추천' })).toBeHidden();
  expect(writes).toBe(0);
});
test('여행 변경 조회 중 담기를 막고 단일 장소만 새 여행에 추가한다', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    writes: any[] = [];
  const a = { ...trip, days: [trip.days[0]] },
    b = { ...trip, id: tid2, title: '두 번째 여행', days: [{ ...trip.days[0], items: [old[1]] }] };
  await mocks(page, async (r, u) => {
    if (u.pathname === '/api/trips') return r.fulfill({ json: { data: [a, b] } });
    if (u.pathname === `/api/trips/${tid}`) return r.fulfill({ json: { data: a } });
    if (u.pathname === `/api/trips/${tid2}`) {
      await gate;
      return r.fulfill({ json: { data: b } });
    }
    if (u.pathname.endsWith('/items')) {
      writes.push({
        method: r.request().method(),
        path: u.pathname,
        body: r.request().postDataJSON(),
      });
      return r.fulfill({ status: 201, json: { saved: true, revision: 1 } });
    }
    if (u.pathname.endsWith('/enrichment')) return r.fulfill({ json: { available: false } });
    return r.fulfill({ json: { data: next[0] } });
  });
  await page.goto('/places/' + next[0].id);
  await page.getByRole('button', { name: '여행에 담기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '어느 하루에 담을까요?' });
  await expect(dialog).toBeVisible();
  await dialog.locator('select').first().selectOption(tid2);
  await expect(dialog.locator('button[type="submit"],button.button.dark')).toBeDisabled();
  expect(writes).toEqual([]);
  release();
  await page.getByRole('button', { name: '이 날짜에 담기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '장소 추가 완료' })).toBeVisible();
  expect(writes).toEqual([
    {
      method: 'POST',
      path: `/api/trips/${tid2}/days/${dates[0]}/items`,
      body: { placeId: next[0].id },
    },
  ]);
});
test('경로 응답이 대기 중이어도 날씨를 먼저 표시한다', async ({ page }) => {
  await mocks(page, async (r) => r.fulfill({ json: { data: trip } }), true);
  await page.goto('/trips/' + tid);
  await expect(page.locator('.weather-chip')).toContainText('맑음');
  await expect(page.locator('.route-default-summary')).toContainText('계산 중');
});
