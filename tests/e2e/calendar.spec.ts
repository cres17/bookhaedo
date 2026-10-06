import { test, expect } from '@playwright/test';
test('상단 준비 현황과 시간표 수정·삭제·인쇄·모바일 화면', async ({ page }) => {
  const tid = '11111111-1111-4111-8111-111111111111';
  const trip = {
    id: tid,
    title: '삿포로에서 보내는 가을',
    transportMode: 'DRIVE',
    isOwner: true,
    days: Array.from({ length: 3 }, (_, i) => ({
      id: `day-${i}`,
      date: `2026-10-${10 + i}`,
      revision: 0,
      items: ['오도리 공원', '삿포로 라멘', '모이와야마 전망대', '숙소 체크인'].map((name, j) => ({
        id: `place-${i}-${j}`,
        name,
        nameJa: name,
        regionId: 'sapporo',
        category: ['ATTRACTION', 'RESTAURANT', 'ATTRACTION', 'LODGING'][j],
        latitude: 43.06,
        longitude: 141.35,
        tags: {},
        note: '',
        startMinute: null as number | null,
        endMinute: null as number | null,
      })),
    })),
  };
  await page.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== '127.0.0.1') return r.abort();
    if (!u.pathname.startsWith('/api/')) return r.continue();
    const path = u.pathname;
    if (path.endsWith('/notifications'))
      return r.fulfill({ json: { invitations: [], notifications: [] } });
    if (path.endsWith('/auth/me'))
      return r.fulfill({
        json: { user: { id: 'me', name: '여행자', role: 'MEMBER', status: 'ACTIVE' } },
      });
    if (path.endsWith('/checklist'))
      return r.fulfill({ json: { data: [{ id: 'task', label: '여권 챙기기', done: true }] } });
    if (path.endsWith('/expenses'))
      return r.fulfill({
        json: {
          data: [],
          budgets: [
            {
              placeId: 'place-0-0',
              name: '오도리 공원',
              visitDate: '2026-10-10',
              estimatedCost: 12800,
              sharedCount: 0,
              personalCount: 0,
            },
          ],
          total: 0,
          transfers: [],
          personalTotal: 0,
          mySharedTotal: 0,
        },
      });
    if (path.endsWith('/members'))
      return r.fulfill({ json: { data: [{ id: 'me', name: '여행자', isOwner: true }] } });
    if (path.endsWith('/routes')) return r.fulfill({ json: { segments: [] } });
    if (path.endsWith('/weather'))
      return r.fulfill({ json: { available: false, notice: '예보 제공 기간 전이에요.' } });
    if (path.endsWith('/schedule')) {
      const body = r.request().postDataJSON();
      const day = trip.days.find((d) => path.includes(d.date))!;
      Object.assign(
        day.items.find((p) => path.includes(p.id))!,
        body,
      );
      day.revision++;
      return r.fulfill({ json: { saved: true, revision: day.revision } });
    }
    if (path.endsWith('/items') && r.request().method() === 'PUT') {
      const body = r.request().postDataJSON();
      const day = trip.days.find((d) => path.includes(d.date))!;
      day.items = day.items.filter((p) => body.placeIds.includes(p.id));
      day.revision++;
      return r.fulfill({ json: { saved: true } });
    }
    if (path === '/api/trips/' + tid) return r.fulfill({ json: { data: trip } });
    return r.fulfill({ json: { data: [] } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/trips/' + tid);
  await expect(page.getByRole('button', { name: '지출', exact: true })).toContainText('12,800엔');
  const tools = await page.getByRole('region', { name: '여행 도구' }).boundingBox();
  const calendar = await page.getByRole('region', { name: '여행 시간표' }).boundingBox();
  expect(tools!.y).toBeLessThan(calendar!.y);
  await page.getByRole('button', { name: '준비', exact: true }).click();
  await expect(page.getByText('여권 챙기기', { exact: true })).toBeVisible();
  const panelHeader = page.locator('.tools-panel .panel-header');
  const titleBox = await panelHeader.getByRole('heading').boundingBox();
  const closeBox = await panelHeader.getByRole('button', { name: '여행 도구 닫기' }).boundingBox();
  expect(Math.max(titleBox!.y, closeBox!.y)).toBeLessThan(
    Math.min(titleBox!.y + titleBox!.height, closeBox!.y + closeBox!.height),
  );
  await panelHeader.screenshot({ path: '/tmp/checklist-header.png' });
  await page.getByRole('button', { name: '여행 도구 닫기' }).click();
  await page.getByRole('button', { name: '일정 숨기기' }).click();
  await expect(page.locator('.calendar-scroll')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: '일정 펼치기' })).toBeVisible();
  await page.getByRole('button', { name: '일정 펼치기' }).click();
  await page.screenshot({ path: '/tmp/calendar-desktop.png', fullPage: true });
  // Hold the deferred initial focus so a user can select a different field first.
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window);
    const pending: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => {
      pending.push(callback);
      return 0;
    };
    (window as any).releaseDialogFocus = () => {
      window.requestAnimationFrame = original;
      pending.forEach((callback) => callback(performance.now()));
    };
  });
  await page
    .getByRole('button', { name: /오도리 공원 .* 일정 수정/ })
    .first()
    .click();
  await page.getByLabel('시작 시간', { exact: true }).fill('08:00');
  await page.getByLabel('종료 시간', { exact: true }).fill('09:00');
  await page.evaluate(() => (window as any).releaseDialogFocus());
  await expect(page.getByLabel('종료 시간', { exact: true })).toBeFocused();
  const savedSchedule = page.waitForRequest((r) => r.url().endsWith('/schedule'));
  await page.getByRole('button', { name: '시간 저장', exact: true }).click();
  expect((await savedSchedule).postDataJSON()).toMatchObject({
    startMinute: 480,
    endMinute: 540,
  });
  await expect(
    page.getByRole('button', { name: '오도리 공원 08:00–09:00 일정 수정' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '오도리 공원 일정 메뉴', exact: true }).first().click();
  await page.getByRole('button', { name: /30분 앞당기기/ }).click();
  await expect(
    page.getByRole('button', { name: '오도리 공원 07:30–08:30 일정 수정' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '오도리 공원 일정 메뉴', exact: true }).first().click();
  await page.getByRole('button', { name: /30분 늦추기/ }).click();
  await page.reload();
  await page.getByRole('button', { name: '오도리 공원 08:00–09:00 일정 수정' }).click();
  await page.getByRole('button', { name: '일정에서 삭제', exact: true }).click();
  await expect(page.getByRole('button', { name: '오도리 공원 08:00–09:00 일정 수정' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '일정 숨기기' }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.calendar-print')).toBeVisible();
  await expect(page.locator('.calendar-scroll')).toBeHidden();
  await page.pdf({ path: '/tmp/calendar-print.pdf', format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: '일정 펼치기' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.calendar-date')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.locator('.planner-page')).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: '/tmp/calendar-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '지출', exact: true }).click();
  await page.screenshot({
    path: '/tmp/calendar-tools-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '여행 도구 닫기' }).click();
  trip.days[0]!.items = [];
  await page.reload();
  await expect(page.locator('.calendar-empty-hero')).toBeVisible();
  await expect(page.locator('.calendar-scroll')).toHaveCount(0);
  await page.screenshot({
    path: '/tmp/calendar-empty-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});
