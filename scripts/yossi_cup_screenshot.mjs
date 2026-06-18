#!/usr/bin/env node
/**
 * Visual screenshot check for the גביע יוסי (Yossi Cup) module.
 *
 * Loads the dashboard, opens the "גביע יוסי" tab, waits for the bracket to
 * render, runs a few structural assertions, and writes desktop + mobile PNGs.
 *
 * Usage:
 *   1) serve the site:   python3 -m http.server 8000
 *   2) run the check:    node scripts/yossi_cup_screenshot.mjs [baseUrl] [outDir]
 *
 * Requires Playwright + a Chromium build. In this environment Chromium is
 * pre-provisioned (PLAYWRIGHT_BROWSERS_PATH); otherwise: npx playwright install chromium
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
// Prefer a global playwright install, fall back to a local one.
let chromium;
try {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
} catch {
  ({ chromium } = require('playwright'));
}

const baseUrl = process.argv[2] || 'http://127.0.0.1:8000/';
const outDir = process.argv[3] || path.resolve('scripts/screenshots');
mkdirSync(outDir, { recursive: true });

const log = (...a) => console.log(...a);
const fail = (msg) => { console.error('❌ ' + msg); process.exitCode = 1; };

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  // ---------- Desktop ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  // Known-benign, environment/design-driven messages that are NOT cup defects:
  //  - the optional logo PNG 404 (intended onerror → CSS-crest fallback)
  //  - the existing app fetching data.json from the GitHub raw CDN (cert/egress),
  //    which gracefully falls back to the local/embedded data.
  const BENIGN = [
    /yossi-cup-2026\.png/i,
    /raw\.githubusercontent\.com/i,
    /ERR_CERT_AUTHORITY_INVALID/i,
    /favicon/i,
    /Failed to load resource/i,
  ];
  const isBenign = (t) => BENIGN.some((re) => re.test(t));
  page.on('pageerror', (e) => { if (!isBenign(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !isBenign(m.text())) errors.push('console: ' + m.text()); });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.click('button.tabBtn[data-view="yossicup"]');
  await page.waitForSelector('#yossicup.view.active', { timeout: 10000 });
  await page.waitForSelector('#yossicup .yc-match-card, #yossicup .yc-bye-card', { timeout: 10000 });
  await page.waitForTimeout(400); // let any fade/layout settle

  // ---- structural assertions ----
  const counts = await page.evaluate(() => ({
    byeCards: document.querySelectorAll('#yossicup .yc-bye-card').length,
    matchCards: document.querySelectorAll('#yossicup .yc-match-card').length,
    title: (document.querySelector('#yossicup h1, #yossicup .yc-title')?.textContent || '').trim(),
    dir: document.documentElement.getAttribute('dir'),
  }));
  log('   rendered →', JSON.stringify(counts));
  if (counts.byeCards !== 14) fail(`expected 14 BYE cards, got ${counts.byeCards}`);
  if (counts.matchCards !== 114) fail(`expected 114 active match cards, got ${counts.matchCards}`);
  if (counts.dir !== 'rtl') fail(`expected dir="rtl", got "${counts.dir}"`);
  if (errors.length) fail('page errors: ' + errors.join(' | '));

  const desktopHero = path.join(outDir, 'yossi-cup-desktop-hero.png');
  const desktopFull = path.join(outDir, 'yossi-cup-desktop-full.png');
  await page.screenshot({ path: desktopHero }); // above-the-fold
  await page.screenshot({ path: desktopFull, fullPage: true });
  log('   saved', desktopHero);
  log('   saved', desktopFull);
  await ctx.close();

  // ---------- Mobile ----------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const mpage = await mctx.newPage();
  await mpage.goto(baseUrl, { waitUntil: 'networkidle' });
  await mpage.click('button.tabBtn[data-view="yossicup"]');
  await mpage.waitForSelector('#yossicup.view.active', { timeout: 10000 });
  await mpage.waitForTimeout(400);
  const mobile = path.join(outDir, 'yossi-cup-mobile.png');
  await mpage.screenshot({ path: mobile, fullPage: true });
  log('   saved', mobile);
  await mctx.close();

  if (process.exitCode === 1) log('\n⚠️  Screenshot check completed WITH assertion failures (see above).');
  else log('\n✅ Visual screenshot check passed (14 BYE + 114 active, RTL, no page errors).');
} finally {
  await browser.close();
}
