import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp();
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 }, timezoneId: 'Asia/Seoul' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());

  await run('default expression is explained with 8 upcoming runs', async () => {
    await page.goto(url); await page.getByText('Every 15 minutes, every day (UTC)').waitFor();
    assert.equal(await page.locator('tbody tr').count() >= 8, true);
    await page.getByText('Nothing saved yet').waitFor();
  });
  await run('live validation errors', async () => {
    await page.fill('#expr', '61 * * * *'); await page.getByText('minute value out of range (0-59)').waitFor(); assert.ok(await page.locator('#save').isDisabled());
    await page.fill('#expr', '* * *'); await page.getByText('Expected 5 fields').waitFor();
    await page.fill('#expr', '0 0 31 2 *'); await page.getByText('never runs').waitFor();
  });
  await run('weekday schedule: description and runs only on weekdays', async () => {
    await page.fill('#expr', '0 9 * * mon-fri'); await page.getByText('At 09:00, on Monday, Tuesday, Wednesday, Thursday and Friday (UTC)').waitFor();
    const days = await page.locator('tbody tr td:first-child').allTextContents();
    for (const d of days) { const wd = new Date(d.slice(0, 10) + 'T00:00:00Z').getUTCDay(); assert.ok(wd >= 1 && wd <= 5, d); assert.match(d, / 09:00 UTC$/); }
    // Local (Seoul = UTC+9) column shows 6:00 PM
    assert.match((await page.locator('tbody tr td:nth-child(2)').first().textContent()), /6:00\s?PM/);
    await page.screenshot({ path: 'e2e/shots/main.png' });
  });
  await run('presets fill the expression', async () => {
    await page.getByRole('button', { name: 'Hourly' }).click(); assert.equal(await page.inputValue('#expr'), '0 * * * *');
    await page.getByText('Every hour, on the hour, every day (UTC)').waitFor();
  });
  await run('save requires label; save, persist across reload', async () => {
    await page.fill('#expr', '0 3 * * *'); await page.getByText('At 03:00, every day (UTC)').waitFor();
    await page.click('#save'); await page.getByText('Label is required').waitFor();
    await page.fill('#label', 'Nightly backup'); await page.click('#save');
    await page.getByText('Saved schedules (1)').waitFor(); await page.reload();
    await page.getByText('Nightly backup').waitFor();
  });
  await run('edit saved job', async () => {
    await page.getByRole('button', { name: 'Edit Nightly backup' }).click();
    assert.equal(await page.inputValue('#expr'), '0 3 * * *'); await page.fill('#expr', '30 4 * * *'); await page.getByText('At 04:30').first().waitFor();
    await page.click('#save'); await page.locator('.item').getByText('30 4 * * *').waitFor();
    await page.getByText('Saved schedules (1)').waitFor();
  });
  await run('server error + network failure surfaced', async () => {
    await page.route('**/api/jobs', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/jobs'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByText('Nightly backup').waitFor();
    await page.route('**/api/explain', (r) => r.abort()); await page.fill('#expr', '1 1 * * *'); await page.getByText('Network error').waitFor(); await page.unroute('**/api/explain');
    await page.fill('#expr', '2 2 * * *'); await page.getByText('At 02:02').first().waitFor();
  });
  await run('XSS in label is inert', async () => {
    await page.fill('#label', '<img src=x onerror=window.__x=1>'); await page.click('#save');
    await page.getByText('Saved schedules (2)').waitFor(); assert.equal(await page.evaluate(() => window.__x), undefined);
  });
  await run('delete jobs', async () => {
    await page.getByRole('button', { name: 'Delete Nightly backup' }).click(); await page.getByText('Saved schedules (1)').waitFor();
    await page.getByRole('button', { name: /^Delete <img/ }).click(); await page.getByText('Nothing saved yet').waitFor();
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    await mp.goto(url); await mp.getByText('Every 15 minutes').waitFor(); await mp.fill('#expr', '*/5 9-17 * * 1-5'); await mp.getByText('between 09:00 and 17:59').waitFor();
    assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
