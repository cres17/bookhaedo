import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { regionGuides, seasons } from '../../frontend/src/region-guides';

test('12개 지역 사계절 안내, 검색 연결, 모바일 레이아웃', async ({ page }) => {
  const email = `region-guide-${randomUUID()}@example.test`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.route('https://maps.googleapis.com/**', (route) => route.abort());
    await page.request.post('/api/auth/register', {
      data: { email, password: 'region-guide-password', name: '지역 안내 확인' },
    });
    await page.goto('/trips');
    await page
      .getByRole('navigation', { name: '주요 메뉴' })
      .getByRole('link', { name: '홋카이도 안내' })
      .click();
    await expect(page).toHaveURL(/\/regions$/);
    await expect(page.locator('.guide-region-card')).toHaveCount(12);
    await page.goto('/explore?region=furano');
    await page.getByRole('link', { name: '지역·계절별 매력 자세히보기' }).click();
    await expect(page.getByRole('heading', { name: '후라노', exact: true })).toBeVisible();
    await expect(page.locator('.page-enter-active,.page-leave-active')).toHaveCount(0);
    await page.locator('.guide-hero').evaluate((el) => el.setAttribute('data-retained', 'yes'));
    const picker = page.getByRole('group', { name: '여행 계절' });
    await picker.evaluate((el) =>
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 100),
    );
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.getByRole('button', { name: '봄 3–5월' }).click();
    await expect(page.getByRole('button', { name: '봄 3–5월' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.locator('.season-next-enter-active,.season-previous-enter-active'),
    ).toHaveCount(0);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThan(3);
    await expect(page.locator('.guide-hero')).toHaveAttribute('data-retained', 'yes');
    await expect(page.locator('.guide-tip-lines li')).toHaveCount(1);
    await expect(
      page.getByRole('heading', { name: '다른 계절의 대표 행사도 만나보세요' }),
    ).toBeVisible();
    await expect(page.locator('.guide-access-notices')).toContainText(
      '봄에는 야외 라벤더가 개화하지 않습니다.',
    );
    await picker.getByRole('button', { name: '봄 3–5월' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: '여름 6–8월' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.locator('.season-next-enter-active,.season-previous-enter-active'),
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: /홋카이 배꼽축제 공식 일정/ })).toHaveAttribute(
      'href',
      'https://hesomatsuri.com/guide',
    );
    for (const id of Object.keys(regionGuides)) {
      await page.getByLabel('다른 지역 둘러보기').selectOption(id);
      for (const season of seasons) {
        await page.getByRole('button', { name: `${season.name} ${season.months}` }).click();
        await expect(
          page.getByRole('heading', {
            name: regionGuides[id]!.seasons[season.id].title,
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.locator('.guide-spot')).toHaveCount(
          regionGuides[id]!.seasons[season.id].spots.length,
        );
      }
    }
    await page.getByLabel('다른 지역 둘러보기').selectOption('furano');
    await expect(page.getByRole('heading', { name: '후라노', exact: true })).toBeVisible();
    await expect(page.locator('.page-enter-active,.page-leave-active')).toHaveCount(0);
    await page.getByRole('button', { name: '여름 6–8월' }).click();
    await expect(
      page.locator(
        '.season-next-enter-active,.season-previous-enter-active,.season-next-leave-active,.season-previous-leave-active',
      ),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: '/tmp/region-guide-desktop.png',
      fullPage: true,
      animations: 'disabled',
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.getByRole('heading', { name: '팜 도미타', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: '/tmp/region-guide-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    const slide = page.locator('.season-slide');
    await slide.dispatchEvent('touchstart', {
      touches: [{ identifier: 1, clientX: 300, clientY: 200 }],
    });
    await slide.dispatchEvent('touchend', {
      changedTouches: [{ identifier: 1, clientX: 100, clientY: 210 }],
    });
    await expect(page.getByRole('button', { name: '가을 9–11월' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.season-next-enter-active,.season-next-leave-active')).toHaveCount(
      0,
    );
    await slide.dispatchEvent('touchstart', {
      touches: [{ identifier: 1, clientX: 100, clientY: 200 }],
    });
    await slide.dispatchEvent('touchend', {
      changedTouches: [{ identifier: 1, clientX: 300, clientY: 210 }],
    });
    await expect(page.getByRole('button', { name: '여름 6–8월' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.locator('.season-previous-enter-active,.season-previous-leave-active'),
    ).toHaveCount(0);
    await page.getByRole('link', { name: '12개 지역 모두 보기' }).click();
    await expect(page.locator('.guide-region-card')).toHaveCount(12);
    await expect(page.getByRole('button', { name: '여름 6–8월' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page
      .locator('.guide-region-card')
      .filter({ has: page.getByRole('heading', { name: '후라노', exact: true }) })
      .click();
    const searchResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/places?') &&
        new URL(response.url()).searchParams.get('q') === 'ファーム富田',
    );
    await page.getByRole('link', { name: '이 장소 검색하기' }).first().click();
    expect((await searchResponse).ok()).toBe(true);
    await expect(page.getByLabel('지역 또는 장소 검색')).toHaveValue('ファーム富田');
    await page.goto('/regions/not-a-region');
    await expect(page.getByRole('heading', { name: '지역을 찾지 못했어요' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    const db = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
    });
    await db.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
    await db.end();
  }
});
