import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(ROOT, 'report', 'node_modules', 'playwright'));

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const scene = arg('scene');
const durationMs = Number(arg('duration-ms', '10000'));
const output = path.resolve(arg('output'));
if (!scene || !Number.isFinite(durationMs) || durationMs < 1000 || !output) {
  throw new Error('usage: node render_capture.mjs --scene=<id> --duration-ms=<ms> --output=<webm>');
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const tempVideoDir = path.join(path.dirname(output), `.pw-${scene}`);
fs.mkdirSync(tempVideoDir, { recursive: true });

// Minimal CI containers may not expose Chromium's shared libraries globally.
// The build script can provide an extracted, repository-local apt sysroot.
const sysroot = path.join(ROOT, 'video', 'build', 'sysroot');
if (fs.existsSync(sysroot)) {
  const localLibraries = [
    path.join(sysroot, 'usr', 'lib', 'x86_64-linux-gnu'),
    path.join(sysroot, 'lib', 'x86_64-linux-gnu'),
    path.join(sysroot, 'usr', 'lib'),
    path.join(sysroot, 'lib')
  ];
  process.env.LD_LIBRARY_PATH = localLibraries.concat(process.env.LD_LIBRARY_PATH || []).join(':');
  process.env.FONTCONFIG_PATH = path.join(sysroot, 'etc', 'fonts');
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  colorScheme: 'dark',
  reducedMotion: 'no-preference',
  recordVideo: { dir: tempVideoDir, size: { width: 1920, height: 1080 } }
});
const page = await context.newPage();
const video = page.video();

async function addBadge(html, tone = 'cyan') {
  await page.evaluate(({ html, tone }) => {
    const badge = document.createElement('div');
    badge.id = 'video-badge';
    badge.innerHTML = html;
    const color = tone === 'green' ? '#75e6ad' : '#70e6ef';
    Object.assign(badge.style, {
      position: 'fixed', zIndex: '999999', top: '92px', right: '38px',
      maxWidth: '560px', padding: '13px 18px', borderRadius: '12px',
      border: `1px solid ${color}66`, background: 'rgba(5,15,22,.88)',
      color, font: '700 17px/1.35 Inter,system-ui,sans-serif', letterSpacing: '.04em',
      boxShadow: '0 18px 55px rgba(0,0,0,.35)', backdropFilter: 'blur(12px)'
    });
    document.body.appendChild(badge);
  }, { html, tone });
}

async function openReport() {
  const report = pathToFileURL(path.join(ROOT, 'report', 'delibrashift_report.html')).href;
  await page.goto(report, { waitUntil: 'load' });
  await page.addStyleTag({ content: `
    html { scroll-behavior: smooth !important; }
    * { cursor: none !important; }
    .cg-topbar { background: rgba(7,16,23,.96) !important; }
  ` });
  await page.waitForTimeout(700);
}

async function scrollWithOffset(selector, offset = 110) {
  await page.locator(selector).waitFor({ state: 'attached' });
  await page.evaluate(({ selector, offset }) => {
    const node = document.querySelector(selector);
    if (node) window.scrollTo({ top: Math.max(0, node.getBoundingClientRect().top + window.scrollY - offset), behavior: 'smooth' });
  }, { selector, offset });
  await page.waitForTimeout(800);
}

async function runScene() {
  if (scene === 'what') {
    await openReport();
    await page.keyboard.press('1');
    await page.evaluate(() => window.scrollTo(0, 0));
    await addBadge('BUILD WEEK 2026 &nbsp;·&nbsp; DEVELOPER TOOLS');
    await page.waitForTimeout(Math.max(1000, durationMs - 1000));
    return;
  }

  if (scene === 'lab') {
    await openReport();
    await page.keyboard.press('3');
    await scrollWithOffset('#cg-lab-stage', 145);
    await addBadge('CANONICAL REPLAY &nbsp;·&nbsp; g001 / END2END / r0');
    await page.keyboard.press('Space');
    await page.waitForTimeout(Math.max(1000, durationMs - 2100));
    return;
  }

  if (scene === 'results') {
    await openReport();
    await page.keyboard.press('2');
    await scrollWithOffset('#cg-findings', 160);
    await addBadge('MATCHED ARCHITECTURE ABLATION &nbsp;·&nbsp; R = 3');
    const phase = Math.max(2500, Math.floor((durationMs - 2200) / 3));
    await page.waitForTimeout(phase);
    await scrollWithOffset('#cg-metric-cards', 150);
    await page.waitForTimeout(phase);
    await scrollWithOffset('#cg-chart-arms', 150);
    await page.waitForTimeout(Math.max(1000, durationMs - 2200 - 2 * phase));
    return;
  }

  if (scene === 'evidence' || scene === 'codex') {
    const deck = pathToFileURL(path.join(HERE, 'evidence.html')).href + `?scene=${scene}`;
    await page.goto(deck, { waitUntil: 'load' });
    await page.waitForTimeout(durationMs);
    return;
  }

  if (scene === 'close') {
    await openReport();
    await page.keyboard.press('3');
    await scrollWithOffset('#cg-lab-stage', 145);
    await addBadge('✓ PYTHON 3.10 + 3.12 &nbsp;·&nbsp; ✓ RELEASE &nbsp;·&nbsp; ✓ SCIENTIFIC GATES &nbsp;·&nbsp; ✓ BROWSER', 'green');
    await page.keyboard.press('Space');
    const first = Math.max(3000, Math.floor(durationMs * .55));
    await page.waitForTimeout(first);
    await page.evaluate(() => {
      const badge = document.getElementById('video-badge');
      if (badge) {
        badge.innerHTML = 'THE WORLD MOVES WHILE AGENTS THINK.';
        badge.style.fontSize = '22px';
        badge.style.color = '#ffb174';
        badge.style.borderColor = '#ff9b5266';
      }
    });
    await page.waitForTimeout(Math.max(1000, durationMs - first - 1300));
    return;
  }

  throw new Error(`unknown scene: ${scene}`);
}

try {
  await runScene();
  await page.close();
  await context.close();
  await video.saveAs(output);
} finally {
  await browser.close();
  fs.rmSync(tempVideoDir, { recursive: true, force: true });
}
