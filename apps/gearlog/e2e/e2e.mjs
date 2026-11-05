import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp({ now: () => new Date('2026-06-01T12:00:00Z') }); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 }, timezoneId: 'UTC' })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date('2026-06-01T12:00:00Z') });
  const text = (s) => page.locator(s).textContent();
  const fill = async (day, odo, l, price, full = true) => { const n = await page.locator('#history li').count(); await page.locator('#fday').fill(day); await page.locator('#fodo').fill(String(odo)); await page.locator('#fl').fill(l); await page.locator('#fp').fill(price); if (!full) await page.locator('#ffull').uncheck(); else await page.locator('#ffull').check(); await page.locator('#add-fill').click(); await page.waitForFunction((c) => document.querySelectorAll('#history li').length === c + 1, n); };
  await run('add a vehicle (validation first)', async () => {
    await page.goto(url); await page.getByText('No vehicles yet').waitFor(); await page.getByRole('button', { name: 'Add vehicle' }).click(); await page.locator('#form-error').getByText('Name is required').waitFor(); await page.locator('#name').fill('Civic'); await page.locator('#plate').fill('ab-123'); await page.getByRole('button', { name: 'Add vehicle' }).click(); await page.locator('#stats').waitFor(); assert.match(await text('.meta'), /AB-123/);
  });
  await run('three fill-ups (one partial) produce correct fuel economy and cost per km', async () => {
    await fill('2026-01-01', 10000, '40', '60.00'); await fill('2026-01-10', 10250, '15.5', '23.25', false); await fill('2026-01-20', 10500, '14.5', '21.75');
    await page.locator('#trips').waitFor(); assert.match(await text('#trips tbody tr'), /500 km.*30\.00 L.*6.*16\.67/); assert.match(await text('#stats'), /6 L\/100 kmAverage/); assert.match(await text('#stats'), /0\.090\/kmFuel cost/); assert.match(await text('#stats'), /10,500 kmOdometer/);
  });
  await run('invalid readings are rejected with the neighbouring value', async () => {
    await page.locator('#fday').fill('2026-03-01'); await page.locator('#fodo').fill('9000'); await page.locator('#fl').fill('30'); await page.locator('#fp').fill('40'); await page.locator('#add-fill').click(); await page.locator('#fill-error').getByText('below 10500').waitFor();
    await page.locator('#fl').fill('abc'); await page.locator('#fodo').fill('11000'); await page.locator('#add-fill').click(); await page.locator('#fill-error').getByText('Liters must look like').waitFor();
  });
  await run('maintenance: a task starts as "never done", becomes ok after a service, then soon and overdue as the odometer grows', async () => {
    await page.locator('#tname').fill('Oil change'); await page.locator('#tkm').fill('10000'); await page.locator('#tmo').fill('12'); await page.locator('#add-task').click(); await page.locator('[data-task="Oil change"]').waitFor(); assert.equal(await page.locator('[data-task="Oil change"] [data-status]').getAttribute('data-status'), 'never');
    await page.locator('#sday').fill('2026-02-10'); await page.locator('#sodo').fill('10500'); await page.locator('#stask').selectOption({ label: 'Oil change' }); await page.locator('#scost').fill('89.90'); await page.locator('#add-service').click(); await page.waitForFunction(() => document.querySelector('[data-task="Oil change"] [data-status]').dataset.status === 'ok');
    assert.match(await text('[data-task="Oil change"]'), /20,500 km · 2027-02-10.*10,000 km/); assert.match(await text('#stats'), /89\.90Service spend/);
    await fill('2026-05-20', 19700, '40', '70', true); await page.waitForFunction(() => document.querySelector('[data-task="Oil change"] [data-status]').dataset.status === 'soon'); await fill('2026-05-25', 20600, '40', '70'); await page.waitForFunction(() => document.querySelector('[data-task="Oil change"] [data-status]').dataset.status === 'overdue');
  });
  await run('list shows attention count; deleting entries and the vehicle', async () => {
    await page.locator('a', { hasText: '← Vehicles' }).click(); await page.locator('[data-car="Civic"]').waitFor(); assert.match(await text('[data-car="Civic"]'), /20,600 km.*1 service need attention/); await page.locator('[data-car="Civic"]').click(); await page.locator('#history').waitFor();
    const n = await page.locator('#history li').count(); await page.locator('#history li').first().locator('button').click(); await page.waitForFunction((c) => document.querySelectorAll('#history li').length === c - 1, n); await page.locator('#delete').click(); await page.getByText('No vehicles yet').waitFor();
  });
  await run('mobile: no horizontal overflow', async () => {
    await page.locator('#name').fill('Van'); await page.getByRole('button', { name: 'Add vehicle' }).click(); await page.locator('#stats').waitFor(); await page.setViewportSize({ width: 360, height: 740 }); await page.waitForTimeout(200); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.goto(url); await page.waitForTimeout(200); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
