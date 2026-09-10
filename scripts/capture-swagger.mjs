import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:5173';
const out = 'docs/screenshots/swagger';

await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

try {
  await page.goto(`${base}/swagger.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.swagger-ui .information-container', { timeout: 20000 });
  await page.waitForSelector('.swagger-ui .opblock-summary-path', { timeout: 20000 });
  await page.waitForTimeout(800);

  await page.screenshot({ path: `${out}/01-api-overview.png`, fullPage: false });
  await page.screenshot({ path: `${out}/02-endpoint-catalog.png`, fullPage: true });

  await page.locator('.opblock-tag').filter({ hasText: /^장소$/ }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/02a-place-recommendation.png`, fullPage: false });

  await page.locator('.opblock-tag').filter({ hasText: /^여행$/ }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/02b-trip-routing.png`, fullPage: false });

  await page.locator('.opblock-tag').filter({ hasText: /^경로$/ }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/02c-route-weather.png`, fullPage: false });

  await page.locator('.opblock-tag').filter({ hasText: /^날씨$/ }).evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -80);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/02d-weather.png`, fullPage: false });

  const dayGet = page.locator('.opblock.opblock-get').filter({
    has: page.locator('.opblock-summary-path', {
      hasText: '/trips/{id}/days/{date}/day-alternatives',
    }),
  });
  await dayGet.locator('.opblock-summary').click();
  await dayGet.locator('.opblock-body').waitFor({ state: 'visible' });
  await dayGet.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/03a-day-alternatives-parameters.png`, fullPage: false });
  await dayGet.screenshot({ path: `${out}/03-day-alternatives-get.png` });

  await dayGet.locator('.responses-wrapper').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/03b-day-alternatives-responses.png`, fullPage: false });

  const dayPatch = page.locator('.opblock.opblock-patch').filter({
    has: page.locator('.opblock-summary-path', {
      hasText: '/trips/{id}/days/{date}/day-alternatives',
    }),
  });
  await dayPatch.locator('.opblock-summary').click();
  await dayPatch.locator('.opblock-body').waitFor({ state: 'visible' });
  await dayPatch.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await dayPatch.screenshot({ path: `${out}/04-day-alternatives-patch.png` });

  const models = page.locator('.models');
  await models.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await models.screenshot({ path: `${out}/05-schemas.png` });
} finally {
  await browser.close();
}

console.log('Swagger screenshots written to', out);
