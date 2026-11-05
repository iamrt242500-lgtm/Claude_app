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
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'Asia/Seoul' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const zone = (z) => page.locator(`[data-zone="${z}"]`);
  const addZone = async (term, zoneId) => { await page.fill('#zone-search', term); await page.locator(`[data-add="${zoneId}"]`).click(); await zone(zoneId).waitFor(); };
  const removeAll = async () => { for (const z of await page.locator('#zones [data-zone]').evaluateAll((l) => l.map((e) => e.dataset.zone))) { await page.getByRole('button', { name: 'Remove ' + z.split('/').at(-1).replaceAll('_', ' ') }).click(); await zone(z).waitFor({ state: 'detached' }); } };
  const bestWindow = async () => (await page.locator('#result h2').textContent());
  const winRows = async () => page.locator('[data-win="0"] tr').evaluateAll((rs) => rs.map((r) => [...r.querySelectorAll('td')].slice(0, 2).map((t) => t.textContent)));

  await run('starts with UTC + the browser zone (Asia/Seoul) and shows their overlap', async () => {
    await page.goto(url); await page.locator('#result').waitFor(); await zone('UTC').waitFor(); await zone('Asia/Seoul').waitFor(); await page.getByText('Best window: 0h').waitFor({ timeout: 2000 }).catch(() => {});
    assert.match(await bestWindow(), /No common working hours|Best window/); await page.locator('svg.tl').waitFor();
  });
  await run('search, add and remove zones; need at least two', async () => {
    await removeAll(); await page.getByText('Add at least two time zones').waitFor();
    await page.fill('#zone-search', 'zzzzqq'); await page.waitForTimeout(400); assert.equal(await page.locator('#zone-results li').count(), 0);
    await addZone('new york', 'America/New_York'); await page.getByText('Add at least two time zones').waitFor(); await addZone('london', 'Europe/London'); await page.locator('#result').waitFor();
  });
  await run('DST trap: NY–London overlap is 3h, then 4h in the week only the US has changed clocks, then 3h again', async () => {
    await page.fill('#date', '2026-03-02'); await page.getByText('Best window: 3h').waitFor(); assert.deepEqual(await winRows(), [['New York', '09:00 – 12:00'], ['London', '14:00 – 17:00']]);
    await page.fill('#date', '2026-03-09'); await page.getByText('Best window: 4h').waitFor(); assert.deepEqual(await winRows(), [['New York', '09:00 – 13:00'], ['London', '13:00 – 17:00']]);
    await page.fill('#date', '2026-04-06'); await page.getByText('Best window: 3h').waitFor(); await page.screenshot({ path: 'e2e/shots/overlap.png' });
  });
  await run('half-hour zone is exact: Kolkata + London = 3h 30m', async () => {
    await addZone('kolkata', 'Asia/Kolkata'); await page.fill('#date', '2026-01-15'); await page.selectOption('#end', '18'); await page.getByText(/No common working hours/).waitFor();   // NY 9–18 vs IST 9–18: never overlap
    for (const z of ['America/New_York']) await page.getByRole('button', { name: 'Remove New York' }).click(); await page.getByText('Best window: 3h 30m').waitFor();
    assert.deepEqual(await winRows(), [['London', '09:00 – 12:30'], ['Kolkata', '14:30 – 18:00']]);
  });
  await run('working-hours validation and widening the window', async () => {
    await page.selectOption('#start', '17'); await page.selectOption('#end', '10'); await page.getByText('start before end').waitFor(); assert.equal(await page.locator('#result').count(), 0);
    await page.selectOption('#start', '0'); await page.selectOption('#end', '24'); await page.getByText('Best window: 24h').waitFor();
  });
  await run('invalid date is reported', async () => {
    await page.fill('#date', ''); await page.dispatchEvent('#date', 'change'); await page.getByText('valid YYYY-MM-DD').waitFor(); await page.fill('#date', '2026-03-09'); await page.getByText(/Best window/).waitFor();
  });
  await run('save a team, reload, load it; duplicate name rejected; delete', async () => {
    await page.selectOption('#start', '8'); await page.selectOption('#end', '18'); await page.fill('#team-name', 'Support'); await page.click('#save-team'); await page.locator('[data-team="Support"]').waitFor();
    await page.fill('#team-name', 'support'); await page.click('#save-team'); await page.getByText('already exists').waitFor();
    await page.reload(); await page.locator('[data-team="Support"]').waitFor(); await page.locator('[data-team="Support"] .load').click(); await zone('Europe/London').waitFor(); await zone('Asia/Kolkata').waitFor(); assert.equal(await page.inputValue('#start'), '8');
    await page.getByRole('button', { name: 'Delete team Support' }).click(); await page.locator('[data-team="Support"]').waitFor({ state: 'detached' });
  });
  await run('server error and network failure are shown', async () => {
    await page.route('**/api/overlap', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' })); await page.fill('#date', '2026-03-10'); await page.getByText('Internal server error').waitFor(); await page.unroute('**/api/overlap');
    await page.route('**/api/overlap', (r) => r.abort()); await page.fill('#date', '2026-03-11'); await page.getByText('Network error').waitFor(); await page.unroute('**/api/overlap');
    await page.fill('#date', '2026-03-12'); await page.locator('#result').waitFor();
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 }, timezoneId: 'Asia/Seoul' })).newPage(); await mp.goto(url); await mp.locator('#result').waitFor(); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(300);
    const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => !e.closest('svg') && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`));
    assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow: ${over.join(', ')}`); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
