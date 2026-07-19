'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function main() {
  const report = path.resolve(__dirname, '..', 'delibrashift_report.html');
  let browser;
  try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];
  const reportUrl = pathToFileURL(report).href;

  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (request.url() !== reportUrl) externalRequests.push(request.url());
  });
  await page.route(/^https?:/i, (route) => route.abort());

  await page.goto(reportUrl, { waitUntil: 'load' });
  await page.waitForSelector('#cg-demo-arena canvas');
  const initialLang = await page.getAttribute('html', 'lang');
  assert.ok(['pl', 'en'].includes(initialLang), `unexpected initial language: ${initialLang}`);
  assert.match(
    await page.locator('#cg-footer-provenance').innerText(),
    initialLang === 'pl' ? /prywatna ewaluacja/i : /private evaluation/i,
  );
  assert.doesNotMatch(
    await page.locator('#cg-footer-notes').innerText(),
    /full run assumes|pełny bieg zakłada/i,
  );

  const paintedColors = await page.locator('#cg-demo-arena canvas').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    const stride = Math.max(4, Math.floor(data.length / 20000 / 4) * 4);
    for (let index = 0; index < data.length; index += stride) {
      if (data[index + 3] !== 0) {
        colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`);
      }
    }
    return colors.size;
  });
  assert.ok(paintedColors >= 8, `arena canvas has only ${paintedColors} sampled colors`);

  for (const tab of ['results', 'lab', 'what']) {
    await page.click(`#cg-tab-${tab}`);
    assert.equal(await page.getAttribute(`#cg-tab-${tab}`, 'aria-selected'), 'true');
    assert.ok(await page.locator(`#cg-panel-${tab}`).isVisible());
  }

  await page.click('#cg-lang [data-lang="en"]');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.match(await page.locator('#cg-footer-provenance').innerText(), /private evaluation/i);
  await page.click('#cg-lang [data-lang="pl"]');
  await page.waitForFunction(() => document.documentElement.lang === 'pl');
  assert.equal(await page.getAttribute('html', 'lang'), 'pl');
  assert.match(await page.locator('#cg-footer-provenance').innerText(), /prywatna ewaluacja/i);
  const oldTheme = await page.getAttribute('html', 'data-theme');
  await page.click('#cg-theme-btn');
  assert.notEqual(await page.getAttribute('html', 'data-theme'), oldTheme);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'mobile viewport has horizontal overflow',
  );

  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  console.log('PASS real Chromium: offline, interactive, painted canvas, mobile-safe');
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
