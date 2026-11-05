import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp({ now: () => new Date('2026-03-02T09:00:00Z') }); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 }, timezoneId: 'UTC' })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date('2026-03-02T09:00:00Z') });
  const text = (s) => page.locator(s).textContent();
  await run('empty board prompts to set up', async () => { await page.goto(url); await page.getByText('Add people and chores under Manage').waitFor(); });
  await run('add three people and three chores (validation shown)', async () => {
    await page.locator('#nav-manage').click(); for (const n of ['Ann', 'Ben', 'Cy']) { await page.locator('#mname').fill(n); await page.getByRole('button', { name: 'Add person' }).click(); await page.locator(`[data-m="${n}"]`).waitFor(); }
    await page.locator('#mname').fill('ann'); await page.getByRole('button', { name: 'Add person' }).click(); await page.locator('#member-error').getByText('already exists').waitFor();
    const add = async (n, pts, every) => { await page.locator('#cname').fill(n); await page.locator('#cpts').fill(String(pts)); await page.locator('#cevery').fill(String(every)); await page.locator('#cstart').fill('2026-03-02'); await page.getByRole('button', { name: 'Add chore' }).click(); await page.locator(`[data-c="${n}"]`).waitFor(); };
    await add('Dishes', 1, 1); await add('Bins', 3, 7); await add('Laundry', 4, 3);
    await page.locator('#cname').fill(''); await page.getByRole('button', { name: 'Add chore' }).click(); await page.locator('#chore-error').getByText('Name is required').waitFor();
  });
  await run('board: three chores due today go to three different people; week is planned', async () => {
    await page.locator('#nav-board').click(); await page.locator('#today [data-a]').first().waitFor(); assert.equal(await page.locator('#today [data-a]').count(), 3);
    const who = await page.locator('#today [data-a] select').evaluateAll((els) => els.map((e) => e.selectedOptions[0].textContent)); assert.equal(new Set(who).size, 3, who.join(',')); assert.equal(await page.locator('[data-day]').count(), 6, 'dishes make every day of the week appear');
    assert.match(await text('#fairness'), /spread \d+/);
  });
  await run('completing a chore updates the person’s done points; reload keeps it', async () => {
    const laundry = page.locator('#today [data-chore="Laundry"]'); const name = await laundry.locator('select').evaluate((e) => e.selectedOptions[0].textContent); await laundry.locator('input[type=checkbox]').check();
    await page.waitForFunction((n) => /4 done/.test(document.querySelector(`[data-member="${n}"]`).textContent), name); await page.reload(); await page.locator('#today [data-chore="Laundry"].done').waitFor();
  });
  await run('reassigning a chore by hand sticks', async () => {
    const dish = page.locator('#today [data-chore="Dishes"]'); await dish.locator('select').selectOption({ label: 'Cy' }); await page.waitForFunction(() => document.querySelector('#today [data-chore="Dishes"] select').selectedOptions[0].textContent === 'Cy'); await page.reload(); await page.locator('#today [data-chore="Dishes"]').waitFor(); assert.equal(await page.locator('#today [data-chore="Dishes"] select').evaluate((e) => e.selectedOptions[0].textContent), 'Cy');
  });
  await run('marking someone away moves their upcoming chores to others', async () => {
    await page.locator('#nav-manage').click(); const ann = page.locator('[data-m="Ann"]'); await ann.locator('input[type=date]').fill('2026-03-08'); await ann.getByRole('button', { name: /Save away date/ }).click(); await page.getByText('Saved').waitFor();
    await page.locator('#nav-board').click(); await page.locator('#people').waitFor(); assert.match(await text('[data-member="Ann"]'), /away until/); const upcoming = await page.locator('[data-day] select').evaluateAll((els) => els.map((e) => e.selectedOptions[0].textContent)); assert.ok(!upcoming.includes('Ann'), 'Ann has nothing in her away week');
  });
  await run('open chores of earlier days show as overdue on later days (fake clock + server date move together)', async () => {
    await page.close(); const p2 = await (await browser.newContext({ viewport: { width: 1000, height: 900 }, timezoneId: 'UTC' })).newPage(); await p2.clock.install({ time: new Date('2026-03-03T09:00:00Z') }); await p2.goto(url); await p2.locator('#today').waitFor();
    // the server clock is fixed at 03-02; a client one day ahead is still honoured
    assert.match(await p2.locator('#overdue h2').textContent(), /Overdue \(\d+\)/); assert.ok((await p2.locator('#overdue [data-a]').count()) >= 2);
    await p2.setViewportSize({ width: 360, height: 740 }); await p2.waitForTimeout(200); assert.ok(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow'); await p2.goto(url + '#/manage'); await p2.waitForTimeout(200); assert.ok(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow on manage'); await p2.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
