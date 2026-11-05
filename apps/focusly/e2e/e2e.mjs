import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

let S = Date.parse('2026-03-10T09:00:00Z');                      // controllable SERVER clock
const { server } = createApp({ now: () => S });
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
const errors = [];
const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); return p; };
// A page whose browser clock is aligned with the server clock; advance() moves both together.
const mkPage = async (ctx) => { const p = watch(await ctx.newPage()); await p.clock.install({ time: new Date(S) }); return p; };
// Move server and browser clocks forward TOGETHER in 1-second chunks (shorter than the 3.5 s toast lifetime), so fake-clock timers (e.g. toast removal) never outrun real network responses.
const advance = async (p, ms) => { for (let left = ms; left > 0; left -= 1000) { const d = Math.min(1000, left); S += d; await p.clock.runFor(d); } };
// Load the app, then freeze the browser clock at the (advanced) server time so both clocks only move via advance().
const boot = async (p) => { await p.goto(url); await p.locator('#clock').waitFor({ timeout: 15000 }).catch(() => {}); S += 5000; await p.clock.pauseAt(new Date(S)); };
const clockText = (p) => p.locator('#clock').evaluate((e) => e.firstChild.nodeValue);
const secs = async (p) => { const [m, sec] = (await clockText(p)).split(':').map(Number); return m * 60 + sec; };
const near = (actual, expected, tol = 3, msg = '') => assert.ok(Math.abs(actual - expected) <= tol, `${msg} expected ≈${expected}s, got ${actual}s`);
const stat = (p, label) => p.locator('.stat', { hasText: label }).locator('b');
try {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1100 }, timezoneId: 'UTC' });
  let page = await mkPage(ctx);

  await run('ready state; settings validation and persistence of durations', async () => {
    await boot(page); assert.equal(await clockText(page), '25:00'); await page.getByText('No sessions yet').waitFor();
    await page.locator('summary', { hasText: 'Settings' }).click(); await page.fill('input[name=focus]', '0'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText('Focus: 1–180 minutes').waitFor();
    await page.fill('input[name=focus]', '30'); await page.fill('input[name=short]', '2'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByRole('button', { name: 'Focus 30m' }).waitFor();
    await page.close(); page = await mkPage(ctx); await boot(page); await page.getByRole('button', { name: 'Short break 2m' }).waitFor(); assert.equal(await clockText(page), '30:00');
    await page.locator('summary', { hasText: 'Settings' }).click(); await page.fill('input[name=focus]', '25'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByRole('button', { name: 'Focus 25m' }).waitFor();
  });
  await run('start a focus session; countdown advances with the clock', async () => {
    await page.fill('#label', 'Write report'); await page.click('#start'); await page.locator('#stop').waitFor();
    near(await secs(page), 25 * 60, 3, 'just started'); await advance(page, 10 * 60000); near(await secs(page), 15 * 60, 3, 'after 10 virtual minutes');
    assert.match(await page.title(), /^\d\d:\d\d · Focus — Focusly$/); assert.equal(await page.locator('#label').isDisabled(), true); assert.equal(await page.locator('[data-kind]').first().isDisabled(), true);
    await page.screenshot({ path: 'e2e/shots/running.png' });
  });
  await run('reload mid-session resumes with the remaining time (state lives on the server)', async () => {
    await page.close(); page = await mkPage(ctx); await boot(page); await page.locator('#stop').waitFor(); near(await secs(page), 15 * 60 - 5, 3, 'resumed after reload (server clock was moved 5s by boot)'); assert.equal(await page.inputValue('#label'), 'Write report');
  });
  await run('time runs out: auto-completes, celebrates, stats and history update', async () => {
    await advance(page, (await secs(page)) * 1000); await page.getByText('Focus complete').waitFor();   // advance exactly to the end: fake-clock toast timers must not outrun the real network round trip
    await page.locator('#start').waitFor();
    await page.waitForFunction(() => document.querySelector('.stat b')?.textContent.startsWith('25 min')); assert.equal(await stat(page, 'Sessions today').textContent(), '1'); assert.equal(await stat(page, 'Streak').textContent(), '1 day');
    await page.locator('#history li', { hasText: 'Write report' }).waitFor(); assert.equal(await page.title(), 'Focusly — focus timer');
  });
  await run('session completes while no tab is open (lazy completion on next visit)', async () => {
    await page.fill('#label', 'Background work'); await page.click('#start'); await page.locator('#stop').waitFor(); await page.close(); S += 26 * 60000;   // tab closed, 26 minutes pass
    page = await mkPage(ctx); await boot(page); await page.locator('#start').waitFor(); await page.waitForFunction(() => document.querySelector('.stat b')?.textContent.startsWith('50 min'));
    await page.locator('#history li', { hasText: 'Background work' }).waitFor();
  });
  await run('stopping early records a cancelled session that does not count', async () => {
    await page.click('#start'); await page.locator('#stop').waitFor(); await advance(page, 5 * 60000); await page.click('#stop'); await page.locator('#start').waitFor();
    await page.locator('#history li .pill.cancelled').first().waitFor(); assert.equal(await stat(page, 'Focus today').textContent(), '50 min');
  });
  await run('breaks run but never count as focus', async () => {
    await page.click('[data-kind=short]'); await page.click('#start'); await page.locator('#stop').waitFor(); await page.locator('.ring.break').waitFor(); await advance(page, 2 * 60000);   // short break was set to 2 minutes in the settings step
    await page.getByText('Short break complete').waitFor(); assert.equal(await stat(page, 'Focus today').textContent(), '50 min');
  });
  await run('a stale second tab cannot start a second session (409) and re-syncs', async () => {
    const other = await mkPage(ctx); await boot(other); await other.locator('#start').waitFor();
    await page.click('[data-kind=focus]'); await page.click('#start'); await page.locator('#stop').waitFor();
    await other.click('#start'); await other.getByText('A session is already running').waitFor(); await other.locator('#stop').waitFor(); await other.close(); await page.click('#stop'); await page.locator('#start').waitFor();
  });
  await run('delete a history entry', async () => {
    const n = await page.locator('#history li').count(); await page.getByRole('button', { name: 'Delete session' }).first().click(); await page.waitForFunction((k) => document.querySelectorAll('#history li').length === k - 1, n);
  });
  await run('label is limited and rendered as text (XSS)', async () => {
    await page.fill('#label', '<img src=x onerror=window.__x=1>'); await page.click('#start'); await page.locator('#stop').waitFor(); assert.equal(await page.evaluate(() => window.__x), undefined);
    await page.click('#stop'); await page.locator('#history li', { hasText: '<img src=x onerror=window.__x=1>' }).first().waitFor();
  });
  await run('server error and network failure on load are shown with Retry', async () => {
    const p = await mkPage(ctx); await p.route('**/api/state*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await p.goto(url); await p.getByRole('alert').getByText('Internal server error').waitFor(); await p.unroute('**/api/state*'); await p.getByRole('button', { name: 'Retry' }).click(); await p.locator('#clock').waitFor();
    await p.route('**/api/sessions/start*', (r) => r.abort()); await p.click('#start'); await p.getByText('Network error').waitFor(); await p.close();
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = watch(await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage()); await mp.goto(url); await mp.locator('#clock').waitFor(); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(300);
    const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`));
    assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow: ${over.join(', ')}`); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
