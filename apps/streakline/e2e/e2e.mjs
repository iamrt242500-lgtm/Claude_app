import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp();
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
mkdirSync('e2e/shots', { recursive: true });
const ymd = (n = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, timezoneId: 'UTC' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const stat = (label) => page.locator('.stat', { hasText: label }).locator('b');

  await run('empty state and validation (name, no weekdays)', async () => {
    await page.goto(url); await page.getByText('No habits yet').waitFor();
    await page.click('#add-habit'); await page.getByText('Name is required').waitFor();
    await page.fill('#habit-name', 'Read'); for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) await page.getByLabel(d, { exact: true }).uncheck({ force: true });
    await page.click('#add-habit'); await page.getByText('Pick at least one valid weekday').waitFor();
  });
  await run('create daily habit; check in today; persists after reload', async () => {
    for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) await page.getByLabel(d, { exact: true }).check({ force: true });
    await page.click('#add-habit'); await page.getByText('0 of 1 done').waitFor();
    await page.getByRole('button', { name: /Read: mark done today/ }).click(); await page.getByText('1 of 1 done').waitFor();
    await page.reload(); await page.getByText('1 of 1 done').waitFor();
    await page.getByRole('button', { name: /Read: mark not done today/ }).click(); await page.getByText('0 of 1 done').waitFor();
    await page.getByRole('button', { name: /Read: mark done today/ }).click(); await page.getByText('1 of 1 done').waitFor();
  });
  await run('detail: backfill builds a streak; gap breaks it; un-toggle', async () => {
    await page.getByRole('link', { name: 'Read' }).click(); await page.getByRole('heading', { name: 'Read' }).waitFor();
    assert.equal(await stat('Current streak').textContent(), '1');
    await page.locator(`[data-day="${ymd(-1)}"]`).click(); await page.locator(`[data-day="${ymd(-2)}"]`).click();
    await page.waitForFunction(() => document.querySelector('.stat b')?.textContent === '3');
    assert.equal(await stat('Longest streak').textContent(), '3'); assert.equal(await stat('Total check-ins').textContent(), '3');
    await page.locator(`[data-day="${ymd(-1)}"]`).click(); await page.waitForFunction(() => document.querySelector('.stat b')?.textContent === '1');
    assert.equal(await stat('Longest streak').textContent(), '1');
    await page.locator(`[data-day="${ymd(-1)}"]`).click(); await page.waitForFunction(() => document.querySelector('.stat b')?.textContent === '3');
    await page.screenshot({ path: 'e2e/shots/detail.png' });
  });
  await run('future days are not clickable', async () => {
    const future = page.locator(`[data-day="${ymd(1)}"]`); if (await future.count()) assert.ok(await future.isDisabled());
  });
  await run('weekday-only habit scheduled/not scheduled grouping; edit schedule', async () => {
    await page.goto(url + '#/'); await page.getByText('1 of 1 done').waitFor(); await page.fill('#habit-name', 'Gym');
    const today = new Date().getUTCDay(), names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const [i, d] of names.entries()) { const l = page.getByLabel(d, { exact: true }); if (i === today) await l.uncheck({ force: true }); }
    await page.click('#add-habit'); await page.getByRole('heading', { name: 'Not scheduled today' }).waitFor();
    await page.getByRole('link', { name: 'Gym' }).click(); await page.getByRole('heading', { name: 'Gym' }).waitFor();
    await page.getByLabel(names[today], { exact: true }).check({ force: true }); await page.click('#save-habit'); await page.getByText('Habit saved').waitFor();
    await page.goto(url + '#/'); await page.getByText('1 of 2 done').waitFor();
  });
  await run('server error, network failure, not found', async () => {
    await page.route('**/api/habits?*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/habits?*'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByRole('heading', { name: 'Today' }).waitFor();
    await page.goto(url + '#/h/999'); await page.getByText('Habit not found').waitFor();
    await page.route('**/api/habits?*', (r) => r.abort()); await page.goto(url + '#/'); await page.reload(); await page.getByText('Network error').waitFor(); await page.unroute('**/api/habits?*'); await page.reload(); await page.getByRole('heading', { name: 'Today' }).waitFor();
  });
  await run('XSS in habit name is inert; delete habit', async () => {
    await page.goto(url + '#/'); await page.fill('#habit-name', '<img src=x onerror=window.__x=1>'); await page.click('#add-habit'); await page.getByText('<img src=x onerror=window.__x=1>').first().waitFor();
    assert.equal(await page.evaluate(() => window.__x), undefined);
    await page.getByRole('link', { name: '<img' }).click(); await page.click('#del'); await page.click('#confirm-del'); await page.getByRole('heading', { name: 'Today' }).waitFor();
    assert.equal(await page.getByText('<img').count(), 0);
  });
  await run('timezone: a user ahead of UTC sees their own "today"', async () => {
    // Pacific/Kiritimati is UTC+14 -> local date can be UTC+1 day; server must honor it (±1 day window).
    const c2 = await browser.newContext({ timezoneId: 'Pacific/Kiritimati' }); const p2 = await c2.newPage();
    await p2.goto(url); await p2.fill('#habit-name', 'TZ'); await p2.click('#add-habit');
    await p2.getByRole('button', { name: /TZ: mark done today/ }).click(); await p2.getByRole('button', { name: /TZ: mark not done today/ }).waitFor();
    await p2.reload(); await p2.getByRole('button', { name: /TZ: mark not done today/ }).waitFor(); await c2.close();
  });
  await run('mobile: no horizontal page overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    for (const h of ['#/', '#/h/1']) { await mp.goto(url + h); await mp.waitForTimeout(250); assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); }
    await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
