import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('장소 예상→공동 실제·개인 지출 수정과 Excel/PDF 내보내기', async ({ page, browser }) => {
  test.setTimeout(90000);
  const email = `expenses-ui-${randomUUID()}@example.test`,
    password = 'expense-ui-password-2026';
  await page.route('https://maps.googleapis.com/**', (r) => r.abort());
  await page.addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printed = 'true';
    };
  });
  let tripId = '';
  try {
    expect(
      (
        await page.request.post('/api/auth/register', {
          data: { email, password, name: '정산 검토' },
        })
      ).status(),
    ).toBe(201);
    const created = await page.request.post('/api/trips', {
      data: { title: '삿포로 지출 기록', startDate: '2026-10-10', days: 1 },
    });
    tripId = (await created.json()).data.id;
    const place = (await (await page.request.get('/api/places?regionId=sapporo&limit=1')).json())
      .data[0];
    const base = `/api/trips/${tripId}`;
    await page.request.post(base + '/days/2026-10-10/items', { data: { placeId: place.id } });
    await page.request.patch(base + `/days/2026-10-10/items/${place.id}/budget`, {
      data: { estimatedCost: 2400, expectedRevision: 1 },
    });
    await page.goto('/trips/' + tripId);
    await page.getByRole('button', { name: '지출', exact: true }).click();
    await expect(page.locator('.budget-list')).toContainText('2,400엔');
    await page.locator('.budget-list button').first().click();
    await expect(page.getByLabel('이름', { exact: true })).toHaveValue(place.name);
    await page.getByLabel('금액 (엔)', { exact: true }).fill('2800');
    await page.getByRole('button', { name: '지출 더하기', exact: true }).click();
    await expect(page.locator('.budget-list')).toContainText('실제 2,800엔');
    await page.getByRole('button', { name: '내 지출' }).click();
    await page.getByLabel('이름', { exact: true }).fill('나만의 기념품');
    await page.getByLabel('금액 (엔)', { exact: true }).fill('500');
    await page.getByRole('button', { name: '지출 더하기', exact: true }).click();
    await expect(page.locator('.personal-summary')).toContainText('500엔');
    await page.getByRole('button', { name: '나만의 기념품 지출 수정' }).click();
    await page.getByLabel('금액 (엔)', { exact: true }).fill('600');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.locator('.personal-summary')).toContainText('600엔');
    await page.getByLabel('범위').selectOption('ALL');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '엑셀 다운로드' }).click();
    const download = await downloadPromise;
    await download.saveAs('/tmp/expense-review.xlsx');
    expect(await download.failure()).toBeNull();
    await page.getByRole('button', { name: 'PDF 저장', exact: true }).click();
    const printFrame = page.frameLocator('iframe[title="정산 PDF 인쇄"]');
    await expect(printFrame.locator('html')).toHaveAttribute('data-printed', 'true');
    await expect(printFrame.locator('body')).toContainText('나만의 기념품');
    const html = await page.locator('iframe[title="정산 PDF 인쇄"]').getAttribute('srcdoc');
    const printPage = await browser.newPage();
    await printPage.setContent(html!);
    await printPage.pdf({
      path: '/tmp/expense-review.pdf',
      preferCSSPageSize: true,
      printBackground: true,
    });
    await printPage.close();
    await page.getByRole('button', { name: '함께' }).click();
    await page.locator('.expense-panel').screenshot({ path: '/tmp/expense-desktop.png' });
    const card = page.locator('.day-plan-entry');
    const copy = await card.locator('.day-entry-copy').boundingBox(),
      button = await card
        .getByRole('button', { name: '하루 코스 추천', exact: true })
        .boundingBox();
    expect(button!.y).toBeGreaterThan(copy!.y + copy!.height);
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 960 });
      const title = await card.getByRole('heading').boundingBox();
      const close = await card.getByRole('button', { name: '일정 추천 숨기기' }).boundingBox();
      const box = await card.boundingBox();
      expect(Math.max(title!.y, close!.y)).toBeLessThan(
        Math.min(title!.y + title!.height, close!.y + close!.height),
      );
      expect(title!.y - box!.y).toBeLessThanOrEqual(28);
      expect(close!.x).toBeGreaterThanOrEqual(title!.x + title!.width);
      await card.screenshot({ path: `/tmp/recommendation-header-${width}.png` });
    }
    await expect(page.locator('.recommendation-close-row')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.locator('.expense-panel').screenshot({ path: '/tmp/expense-mobile.png' });
    await page.getByRole('button', { name: '여행 도구 닫기' }).click();
    await page.locator('summary').filter({ hasText: '예상 비용' }).click();
    await page.getByLabel(place.name + ' 예상 비용', { exact: true }).fill('3000');
    await page.getByRole('button', { name: '저장' }).click();
    await page.getByRole('button', { name: '지출', exact: true }).click();
    await expect(page.locator('.budget-list')).toContainText('예상 3,000엔');
    await expect(page.getByRole('button', { name: '지출', exact: true })).toContainText(
      '예상 3,000엔',
    );
  } finally {
    if (tripId) await page.request.delete('/api/trips/' + tripId);
    await page.request.delete('/api/auth/me', { data: { password } });
  }
});
