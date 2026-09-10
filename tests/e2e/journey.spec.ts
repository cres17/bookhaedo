import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const email = `e2e-${randomUUID()}@example.test`,
  password = 'e2e-password-2026';
test.afterAll(async () => {
  const db = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
  });
  await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
  await db.end();
});
test('실제 UI: 가입 → 여행 생성 → 탐색 → 장소 담기 → 날짜 변경 → 새로고침 복원', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Google is tested separately with the real key. This test verifies the UI
  // still works when its external script is unavailable, without mocks for REST/DB.
  await page.route('https://maps.googleapis.com/**', (r) => r.abort());
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '가고 싶은 곳을 하나의 여행으로 .' }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/landing-desktop.png', fullPage: true });
  await page.getByRole('link', { name: '시작하기' }).click();
  await page.getByLabel('이름', { exact: true }).fill('눈꽃 여행자');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '계정 만들고 시작하기' }).click();
  await expect(page).toHaveURL(/explore/);
  await expect(page.locator('.place-card').first()).toBeVisible();
  await page.getByRole('link', { name: '나의 여행', exact: true }).click();
  await page.getByRole('button', { name: '새 여행 만들기' }).click();
  await page.getByLabel('여행 이름', { exact: true }).fill('눈꽃 홋카이도');
  await page.getByLabel('출발일').fill('2026-10-01');
  await page.getByLabel('여행 일수').fill('3');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '눈꽃 홋카이도' })).toBeVisible();
  const tripUrl = page.url();
  await page.getByRole('link', { name: '첫 장소 찾기' }).click();
  await page.getByLabel('지역 또는 장소 검색').fill('삿포로');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await expect(page.locator('.results-heading')).toContainText('삿포로');
  await page.locator('.place-card').first().click();
  await expect(page.getByRole('heading', { name: '방문을 위한 작은 메모' })).toBeVisible();
  await page.getByRole('button', { name: '여행에 담기' }).click();
  await page.getByRole('button', { name: '이 날짜에 담기' }).click();
  await expect(page.getByRole('dialog', { name: '장소 추가 완료' })).toBeVisible();
  await page.getByRole('link', { name: '여행 일정으로 이동하기', exact: true }).click();
  await expect(page.locator('.itinerary-stop')).toHaveCount(1);
  await page.getByRole('link', { name: '지도에서 장소 찾기' }).click();
  await page.locator('.place-card').nth(1).click();
  await page.getByRole('button', { name: '여행에 담기' }).click();
  await page.getByRole('button', { name: '이 날짜에 담기' }).click();
  await expect(page.getByRole('dialog', { name: '장소 추가 완료' })).toBeVisible();
  await page.getByRole('link', { name: '여행 일정으로 이동하기', exact: true }).click();
  await expect(page.locator('.itinerary-stop')).toHaveCount(2);
  await expect(page.locator('.route-between')).toContainText('km', { timeout: 25000 });
  const before = await page.locator('.stop-name').allTextContents();
  await page
    .getByRole('button', { name: /위로 이동/ })
    .nth(1)
    .click();
  await expect(page.locator('.stop-name').first()).toHaveText(before[1]!);
  await expect(page.locator('.saved-note')).toContainText('일정 변경 자동 저장');
  await expect(page.locator('.map-loading')).toBeHidden();
  await page.screenshot({ path: 'docs/screenshots/planner-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.stop-name').first()).toHaveText(before[1]!);
  await page.getByRole('button', { name: /DAY 02/ }).click();
  await expect(page.locator('.itinerary-stop')).toHaveCount(0);
  await page.getByRole('button', { name: /DAY 01/ }).click();
  await expect(page.locator('.itinerary-stop')).toHaveCount(2);
  await page.getByRole('button', { name: '삭제', exact: true }).last().click();
  await expect(page.locator('.itinerary-stop')).toHaveCount(1);
  await page.getByRole('button', { name: '날짜 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: /DAY 04/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/screenshots/planner-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.goto(tripUrl);
  await expect(page).toHaveURL(/login/);
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(tripUrl);
  await expect(page.getByRole('heading', { name: '눈꽃 홋카이도' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('모바일 소개: 가로 넘침 없이 가입과 지역 탐색 가능', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '가고 싶은 곳을 하나의 여행으로 .' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'docs/screenshots/landing-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '나의 여행 그리기' }).click();
  await expect(page).toHaveURL(/login/);
});
