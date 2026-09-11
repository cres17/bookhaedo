import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('로그아웃 초대 링크 → 비밀번호 재확인 → 수락 → 같은 링크 재방문', async ({
  page,
  browser,
}) => {
  const password = 'invitation-entry-password';
  const owner = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const email = `invite-entry-${randomUUID()}@example.test`;
  try {
    await owner.request.post('/api/auth/register', {
      data: { email: `owner-${email}`, password, name: '소유자' },
    });
    const created = await owner.request.post('/api/trips', {
      data: { title: '우리 삿포로 여행', startDate: '2026-10-10', days: 1 },
    });
    const trip = (await created.json()).data.id;
    const link = (
      await (await owner.request.post(`/api/trips/${trip}/invitations`, { data: {} })).json()
    ).path;
    await page.route('https://maps.googleapis.com/**', (r) => r.abort());
    await page.goto(link);
    await expect(page).toHaveURL(/login/);
    await page.getByRole('link', { name: '회원가입', exact: true }).click();
    await page.getByLabel('이름', { exact: true }).fill('새 동행자');
    await page.getByLabel('이메일', { exact: true }).fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 재확인', { exact: true }).fill('different-password');
    await page.getByRole('button', { name: '계정 만들고 시작하기' }).click();
    await expect(page.getByRole('alert')).toContainText('비밀번호가 일치하지');
    await page.getByLabel('비밀번호 재확인', { exact: true }).fill(password);
    await page.getByRole('button', { name: '계정 만들고 시작하기' }).click();
    await page.getByRole('button', { name: '초대 수락하고 여행 보기' }).click();
    await expect(page).toHaveURL(new RegExp(`/trips/${trip}/`));
    expect(decodeURIComponent(page.url())).toContain('우리-삿포로-여행');
    await page.goto(link);
    await expect(page.getByText('이미 참여 중인 여행이에요.', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: '여행 보기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '우리 삿포로 여행' })).toBeVisible();
  } finally {
    await page.request.delete('/api/auth/me', { data: { password } });
    await owner.request.delete('/api/auth/me', { data: { password } });
    await owner.close();
  }
});
