import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { pool } from '../../server/db';
test('관리자 회원 검색·상태 변경·감사 이력 및 모바일 화면', async ({ page }) => {
  const emails = [
    `admin-ui-${randomUUID()}@example.test`,
    `member-ui-${randomUUID()}@example.test`,
  ];
  let aid = '',
    mid = '';
  try {
    const member = await page.request.post('/api/auth/register', {
      data: { email: emails[1], password: 'test-password-42', name: '관리 대상' },
    });
    mid = (await member.json()).user.id;
    const admin = await page.request.post('/api/auth/register', {
      data: { email: emails[0], password: 'test-password-42', name: 'QA 관리자' },
    });
    aid = (await admin.json()).user.id;
    expect((await page.request.get('/api/admin/users')).status()).toBe(403);
    await pool.query("UPDATE planner.app_user SET role='ADMIN' WHERE id=$1", [aid]);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '서비스 관리' })).toBeVisible();
    await page.getByLabel('회원 검색').fill(emails[1]);
    await page.getByRole('button', { name: '검색', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: emails[1] });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '수정', exact: true }).click();
    await page.getByLabel('상태', { exact: true }).selectOption('SUSPENDED');
    await page.getByRole('button', { name: '변경 확인 및 저장' }).click();
    await expect(row).toContainText('이용정지');
    await page.getByRole('button', { name: '변경 이력', exact: true }).click();
    await expect(page.locator('.audit-entry').filter({ hasText: mid })).toContainText('SUSPENDED');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'docs/screenshots/admin-mobile.png', fullPage: true });
  } finally {
    await pool.query('DELETE FROM planner.admin_audit WHERE actor_id=$1', [aid || null]);
    await pool.query('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [emails]);
  }
});
