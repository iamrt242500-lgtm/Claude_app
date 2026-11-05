import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp({ now: () => new Date('2026-03-15T12:00:00Z') }); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 }, timezoneId: 'UTC' })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date('2026-03-15T12:00:00Z') });
  const text = (s) => page.locator(s).textContent();
  const add = async (n, p, every, unit, start, cat) => { await page.locator('#name').fill(n); await page.locator('#price').fill(p); await page.locator('#every').fill(String(every)); await page.locator('#unit').selectOption(unit); await page.locator('#start').fill(start); await page.locator('#category').selectOption(cat); await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.locator(`[data-sub="${n}"]`).waitFor(); };
  await run('empty overview; adding validates the price format', async () => {
    await page.goto(url); await page.getByText('Nothing yet').waitFor(); await page.locator('#nav-subs').click(); await page.locator('#name').fill('X'); await page.locator('#price').fill('abc'); await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.locator('#form-error').getByText('Price must look like').waitFor();
  });
  await run('add monthly (month-end), yearly and weekly plans; renewals computed', async () => {
    await page.locator('#name').fill(''); await add('Streamy', '15.99', 1, 'month', '2025-08-31', 'entertainment'); await add('Cloud', '120', 1, 'year', '2025-06-10', 'software'); await add('Paper', '5', 1, 'week', '2026-03-02', 'news');
    assert.match(await text('[data-sub="Streamy"]'), /renews Tue, Mar 31 \(in 16 days\)/); assert.match(await text('[data-sub="Cloud"]'), /10\.00\/mo.*renews Wed, Jun 10/); assert.match(await text('[data-sub="Paper"]'), /21\.67\/mo.*renews Mon, Mar 16 \(tomorrow\)/);
    assert.deepEqual(await page.locator('#subs [data-sub] strong').allTextContents(), ['Paper', 'Streamy', 'Cloud'], 'ordered by next renewal');
  });
  await run('overview: totals, categories and the 30-day payment list', async () => {
    await page.locator('#nav-over').click(); await page.locator('#upcoming').waitFor(); const t = await text('#summary'); assert.match(t, /3Active/); assert.match(t, /47\.66Per month/); assert.match(t, /40\.99Next 30 days/);
    assert.equal(await page.locator('[data-up^="Paper:"]').count(), 5); assert.match(await text('[data-up="Paper:2026-03-16"]'), /tomorrow/); assert.equal(await page.locator('[data-up^="Cloud:"]').count(), 0); assert.equal(await page.locator('.cat').count(), 3);
    await page.locator('#days').selectOption('90'); await page.waitForFunction(() => document.querySelectorAll('[data-up^="Cloud:"]').length === 1);
  });
  await run('cancelling removes it from totals and shows the savings', async () => {
    await page.locator('#nav-subs').click(); await page.getByRole('button', { name: 'Cancel Paper' }).click(); await page.locator('[data-sub="Paper"].off').waitFor(); assert.match(await text('[data-sub="Paper"]'), /cancelled/); assert.ok(!/renews/.test(await text('[data-sub="Paper"]')));
    await page.locator('#nav-over').click(); await page.locator('#saved').waitFor(); assert.match(await text('#saved'), /saving 21\.67 a month \(260\.00 a year\)/); assert.equal(await page.locator('[data-up^="Paper:"]').count(), 0);
    await page.locator('#nav-subs').click(); await page.getByRole('button', { name: 'Resume Paper' }).click(); await page.waitForFunction(() => !document.querySelector('[data-sub="Paper"].off'));
  });
  await run('delete', async () => { await page.getByRole('button', { name: 'Delete Cloud' }).click(); await page.waitForFunction(() => !document.querySelector('[data-sub="Cloud"]')); });
  await run('mobile: no horizontal overflow', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); for (const h of ['#/', '#/subs']) { await page.goto(url + h); await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); } await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
