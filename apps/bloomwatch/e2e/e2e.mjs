import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

let clock = '2026-07-10T12:00:00Z'; const { server } = createApp({ now: () => new Date(clock) }); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 }, timezoneId: 'UTC' })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date(clock) });
  const text = (s) => page.locator(s).textContent(); const setDay = async (iso) => { clock = iso; await page.clock.setFixedTime(new Date(iso)); };
  const addPlant = async (n, every, seasonal = true) => { await page.locator('#name').fill(n); await page.locator('#every').fill(String(every)); if (!seasonal) await page.locator('#seasonal').uncheck(); await page.getByRole('button', { name: 'Add plant' }).click(); await page.locator('#status').waitFor(); await page.locator('#nav-plants').click(); await page.locator(`[data-plant="${n}"]`).waitFor(); };
  await run('empty today board; adding a plant validates', async () => {
    await page.goto(url); await page.getByText('No plants yet — add one').waitFor(); await page.locator('#nav-plants').click(); await page.getByRole('button', { name: 'Add plant' }).click(); await page.locator('#form-error').getByText('Name is required').waitFor();
  });
  await run('a new, never-watered plant is due today and shows on the board', async () => {
    await addPlant('Fern', 8); await addPlant('Cactus', 21, false); await page.locator('#nav-today').click(); await page.locator('#due-today [data-plant="Fern"]').waitFor(); assert.match(await text('#due-today [data-plant="Fern"]'), /never watered · every 6 days in summer/); assert.match(await text('#info'), /summer · 2 plants/);
  });
  await run('watering moves a plant off the due list and schedules the next one with the seasonal interval', async () => {
    await page.getByRole('button', { name: 'Water Fern' }).click(); await page.getByText('Watered Fern').waitFor(); await page.locator('#ok [data-plant="Fern"]').waitFor(); assert.match(await text('#ok [data-plant="Fern"]'), /in 6 days/); assert.match(await text('#ok [data-plant="Fern"]'), /last watered Fri, Jul 10/);
    await page.getByRole('button', { name: 'Water Cactus' }).click(); await page.waitForFunction(() => !document.querySelector('#due-today')); assert.equal(await page.locator('#nothing').count(), 1);
  });
  await run('time passes: soon → today → overdue (fake clock and server clock move together)', async () => {
    await setDay('2026-07-14T12:00:00Z'); await page.reload(); await page.locator('#soon [data-plant="Fern"]').waitFor(); await setDay('2026-07-16T12:00:00Z'); await page.reload(); await page.locator('#due-today [data-plant="Fern"]').waitFor(); await setDay('2026-07-20T12:00:00Z'); await page.reload(); await page.locator('#overdue [data-plant="Fern"]').waitFor(); assert.match(await text('#overdue [data-plant="Fern"]'), /4 days late/);
  });
  await run('plant page: back-dated watering, history, adherence, undo', async () => {
    await page.locator('#nav-plants').click(); await page.locator('[data-plant="Fern"]').click(); await page.locator('#water').waitFor(); await page.locator('#wday').fill('2026-07-16'); await page.locator('#wnote').fill('soaked'); await page.locator('#water').click(); await page.getByText('Logged').waitFor();
    await page.locator('#history li[data-day="2026-07-16"]').waitFor(); assert.match(await text('#history'), /soaked/); assert.match(await text('#adherence'), /Recent average gap 6 days — 2 earlier than the 8-day plan/); assert.match(await text('#status'), /Last watered Thu, Jul 16\. Next: Wed, Jul 22/);
    await page.locator('#history li[data-day="2026-07-16"] button').click(); await page.waitForFunction(() => !document.querySelector('#history li[data-day="2026-07-16"]'));
  });
  await run('winter / hemisphere setting changes intervals', async () => {
    await setDay('2026-12-20T12:00:00Z'); await page.goto(url + '#/plants'); await page.locator('[data-plant="Fern"]').waitFor(); await page.reload(); await page.locator('#nav-today').click(); await page.getByRole('button', { name: 'Water Fern' }).click(); await page.waitForFunction(() => /every 14 days in winter/.test(document.body.textContent));
    await page.locator('#nav-plants').click(); await page.locator('#south').check(); await page.getByText('Saved').waitFor(); await page.locator('#nav-today').click(); await page.waitForFunction(() => /every 6 days in summer/.test(document.body.textContent)); await page.locator('#nav-plants').click(); await page.locator('#south').uncheck(); await page.getByText('Saved').waitFor();
  });
  await run('archive removes it from the board; delete', async () => {
    await page.locator('[data-plant="Fern"]').click(); await page.locator('#archive').click(); await page.getByText('Archived.').waitFor(); await page.locator('#nav-today').click(); await page.waitForFunction(() => !document.querySelector('[data-plant="Fern"]')); await page.locator('#nav-plants').click(); await page.locator('[data-plant="Fern"]').click(); await page.locator('#delete').click(); await page.waitForFunction(() => !document.querySelector('[data-plant="Fern"]'));
  });
  await run('mobile: no horizontal overflow', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); for (const h of ['#/', '#/plants']) { await page.goto(url + h); await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); } await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
