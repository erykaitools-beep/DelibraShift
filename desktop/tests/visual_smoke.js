'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../../report/node_modules/playwright');


async function main() {
  const root = path.resolve(__dirname, '..', '..');
  const python = process.env.PYTHON || path.join(root, '.venv', 'bin', 'python');
  const source = [
    'import json',
    'from delibrashift.lab import LabEngine',
    "engine = LabEngine('packs/core_v0')",
    "print(json.dumps({'catalog': engine.catalog(), 'run': engine.run('g001', 'lead-greedy', 0)}))",
  ].join(';');
  const payload = JSON.parse(execFileSync(python, ['-c', source], {
    cwd: root,
    encoding: 'utf8',
  }));
  const pageUrl = pathToFileURL(path.join(root, 'delibrashift', 'desktop_assets', 'index.html')).href;
  const screenshot = process.env.DELIBRASHIFT_DESKTOP_SCREENSHOT || '/tmp/delibrashift-lab-smoke.png';
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    const remoteRequests = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) remoteRequests.push(request.url());
    });
    await page.route(/^https?:/i, (route) => route.abort());
    await page.addInitScript((data) => {
      window.pywebview = {
        api: {
          catalog: async () => data.catalog,
          run_scenario: async () => data.run,
          save_last_run: async () => ({ ok: true, path: '/tmp/episode.jsonl' }),
        },
      };
    }, payload);
    await page.goto(pageUrl, { waitUntil: 'load' });
    await page.evaluate(() => window.dispatchEvent(new Event('pywebviewready')));
    await page.waitForFunction(() => document.querySelector('#metric-tick').textContent.includes('/'));

    assert.equal(await page.locator('#scenario').inputValue(), 'g001');
    assert.equal(await page.locator('#agent').inputValue(), 'lead-greedy');
    assert.match(await page.locator('#status').innerText(), /decisions/);
    assert.match(await page.locator('#metric-outcome').innerText(), /RUNNING/);
    await page.click('#step');
    assert.equal(await page.locator('#tick-output').evaluate((output) => output.value), '1');

    const paintedColors = await page.locator('#arena').evaluate((canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      const stride = Math.max(4, Math.floor(pixels.length / 20000 / 4) * 4);
      for (let index = 0; index < pixels.length; index += stride) {
        if (pixels[index + 3]) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
      }
      return colors.size;
    });
    assert.ok(paintedColors >= 8, `arena canvas has only ${paintedColors} sampled colors`);
    assert.deepEqual(remoteRequests, []);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log(`PASS desktop visual smoke: ${screenshot}`);
  } finally {
    await browser.close();
  }
}


main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
