import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('공동 여행: 추천 토글·예산·체크리스트·초대 수락·채팅·정산·알림·탈퇴', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const password = 'collaboration-e2e-2026';
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' }),
    peer = await other.newPage();
  page.setDefaultTimeout(15000);
  peer.setDefaultTimeout(15000);
  for (const p of [page, peer]) await p.route('https://maps.googleapis.com/**', (r) => r.abort());
  const email = `collab-ui-${randomUUID()}@example.test`,
    peerEmail = `collab-ui-${randomUUID()}@example.test`;
  try {
    expect(
      (
        await page.request.post('/api/auth/register', {
          data: { email, password, name: '여행 소유자' },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await peer.request.post('/api/auth/register', {
          data: { email: peerEmail, password, name: '함께 가는 친구' },
        })
      ).status(),
    ).toBe(201);
    const result = await page.request.post('/api/trips', {
      data: { title: '함께 만드는 삿포로 여행', startDate: '2027-02-10', days: 1 },
    });
    expect(result.status()).toBe(201);
    const id = (await result.json()).data.id;
    const place = (await (await page.request.get('/api/places?regionId=sapporo&limit=1')).json())
      .data[0];
    await page.request.post(`/api/trips/${id}/days/2027-02-10/items`, {
      data: { placeId: place.id },
    });
    await page.goto('/trips/' + id);
    await expect(page.getByText('하루 코스를 통째로 다시 짜볼까요?')).toBeVisible();
    await page.getByRole('button', { name: '일정 추천 숨기기', exact: true }).click();
    await expect(page.getByText('하루 코스를 통째로 다시 짜볼까요?')).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: '하루 코스 추천 켜기' })).toBeVisible();
    await page.getByRole('button', { name: '하루 코스 추천 켜기' }).click();
    await page.locator('summary').filter({ hasText: '얼마나 들까요?' }).click();
    await page.getByLabel(place.name + ' 예상 비용', { exact: true }).fill('2400');
    await page.getByRole('button', { name: '예상 비용 저장' }).click();
    await expect(page.getByRole('status')).toContainText('장소 예상 비용');
    await page.getByRole('button', { name: '체크리스트', exact: true }).click();
    await page.getByLabel('새 체크리스트 항목').fill('여권과 eSIM 준비');
    await page.locator('.tools-panel').getByRole('button', { name: '추가', exact: true }).click();
    await page.getByLabel('여권과 eSIM 준비', { exact: true }).check();
    await expect(page.getByText('1 / 1 완료')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('checklist-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '동행자 · 초대' }).click();
    await page.getByLabel('초대할 이메일').fill(peerEmail);
    await page.getByRole('button', { name: '초대장 보내기' }).click();
    await expect(page.getByLabel('공유 초대 링크')).toBeVisible();
    const inviteUrl = await page.getByLabel('공유 초대 링크').inputValue();
    await peer.goto(inviteUrl);
    await expect(peer.getByRole('heading', { name: '함께 떠날 준비가 됐나요?' })).toBeVisible();
    await peer.getByRole('button', { name: '초대 수락하고 여행 보기' }).click();
    await expect(peer).toHaveURL(new RegExp('/trips/' + id));
    await expect(peer.locator('summary').filter({ hasText: '2,400엔' })).toBeVisible();
    await peer.locator('summary').filter({ hasText: '메모 추가' }).click();
    await peer.getByLabel(place.name + ' 메모', { exact: true }).fill('친구와 함께 볼 메모');
    await peer.getByRole('button', { name: '메모 저장' }).click();
    await expect(peer.getByRole('status')).toContainText('메모를 저장');
    await peer.getByRole('button', { name: '여행 채팅', exact: true }).click();
    await peer.getByLabel('채팅 메시지').fill('첫날 저녁은 라멘 어때요?');
    await peer.getByRole('button', { name: '전송', exact: true }).click();
    await page.getByRole('button', { name: '여행 채팅', exact: true }).click();
    await expect(page.getByRole('log')).toContainText('첫날 저녁은 라멘 어때요?');
    await page.getByLabel('채팅 메시지').fill('좋아요! 일곱 시에 만나요.');
    await page.getByRole('button', { name: '전송', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('chat-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '정산 계산기', exact: true }).click();
    await page.getByLabel('지출 내용').fill('라멘 저녁');
    await page.getByLabel('금액 (JPY · 엔)').fill('3001');
    await page.getByRole('button', { name: '지출 기록', exact: true }).click();
    await expect(page.getByText('총 3,001엔')).toBeVisible();
    await expect(page.locator('.transfer')).toContainText('함께 가는 친구');
    await page.screenshot({ path: testInfo.outputPath('settlement-desktop.png'), fullPage: true });
    await page.locator('.notification-toggle').click();
    await expect(page.locator('.notification-popover')).toContainText('초대를 수락했어요');
    await page
      .locator('.notification-popover')
      .getByRole('button', { name: '알림 닫기', exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('settlement-mobile.png'), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await peer.locator('.notification-toggle').click();
    await peer.getByRole('button', { name: '계정 관리 · 회원 탈퇴' }).click();
    await peer.getByLabel('현재 비밀번호').fill(password);
    await peer.getByLabel('삭제 범위를 확인했으며 탈퇴에 동의합니다.').check();
    await peer.getByRole('button', { name: '탈퇴 확정' }).click();
    await expect(peer).toHaveURL('http://127.0.0.1:5173/');
    expect((await page.request.get('/api/trips/' + id)).status()).toBe(200);
  } finally {
    await peer.request
      .delete('/api/auth/me', { data: { password }, timeout: 5000 })
      .catch(() => {});
    await page.request
      .delete('/api/auth/me', { data: { password }, timeout: 5000 })
      .catch(() => {});
    await other.close();
  }
});
