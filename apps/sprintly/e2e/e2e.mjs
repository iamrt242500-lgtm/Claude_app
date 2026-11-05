import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

let clock = '2026-03-09T09:00:00Z'; const { server } = createApp({ now: () => new Date(clock) }); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, timezoneId: 'UTC' }); const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  const text = (s) => page.locator(s).textContent();
  // the browser clock and the server clock are advanced together, one working day at a time
  const setDay = async (iso) => { clock = iso; await page.clock.setFixedTime(new Date(iso)); };
  await page.clock.install({ time: new Date('2026-03-09T09:00:00Z') });
  const addTask = async (t, p) => { await page.locator('#ttitle').fill(t); await page.locator('#tpts').fill(String(p)); await page.locator('#add-task').click(); await page.locator(`[data-task="${t}"]`).waitFor(); };
  await run('create a two-week sprint (validation first)', async () => {
    await page.goto(url); await page.getByText('No sprints yet').waitFor(); await page.locator('#name').fill('Sprint 1'); await page.locator('#start').fill('2026-03-09'); await page.locator('#end').fill('2026-03-08'); await page.getByRole('button', { name: 'Create sprint' }).click(); await page.locator('#form-error').getByText('can’t be before').waitFor();
    await page.locator('#end').fill('2026-03-20'); await page.locator('#goal').fill('Ship login'); await page.getByRole('button', { name: 'Create sprint' }).click(); await page.locator('#burndown').waitFor(); assert.match(await text('.meta'), /10 working days · Goal: Ship login/);
  });
  await run('add tasks: scope grows, ideal line runs from the total down to zero', async () => {
    await addTask('Login', 8); await addTask('Signup', 5); await addTask('Emails', 5); await addTask('Docs', 2); assert.match(await text('#stats'), /20Remaining/); assert.match(await text('#stats'), /20Scope/);
    assert.ok((await page.locator('#ideal-line').getAttribute('d')).startsWith('M')); assert.equal(await page.locator('#burndown circle').count(), 1, 'only today has an actual point'); assert.equal(await page.locator('#burndown circle').getAttribute('data-remaining'), '20');
    await page.locator('#ttitle').fill(''); await page.locator('#add-task').click(); await page.locator('#task-error').getByText('Title is required').waitFor();
  });
  await run('finishing a task shows progress, velocity and a finish forecast', async () => {
    await page.locator('[data-task="Login"] input[type=checkbox]').check(); await page.waitForFunction(() => document.querySelectorAll('#done [data-task]').length === 1); assert.match(await text('#stats'), /12Remaining/); assert.match(await text('#stats'), /8Done/);
    assert.equal(await text('#status'), 'ahead'); assert.match(await text('#forecast'), /At 8 pts\/day the remaining 12 pts finish on Wed, Mar 11 — inside the sprint/);
  });
  await run('advance two working days: the chart gets points for each day; mid-sprint scope is flagged', async () => {
    await setDay('2026-03-11T09:00:00Z'); await page.reload(); await page.locator('#burndown').waitFor(); assert.equal(await page.locator('#burndown circle').count(), 3);
    assert.equal(await page.locator('#burndown circle[data-day="2026-03-10"]').getAttribute('data-remaining'), '12', 'Login was finished on 03-09'); await addTask('Urgent bug', 3); assert.match(await text('[data-task="Urgent bug"]'), /added mid-sprint/); assert.match(await text('#stats'), /20 \+3Scope/);
    assert.equal(await page.locator('#burndown circle[data-day="2026-03-11"]').getAttribute('data-remaining'), '15'); assert.equal(await page.locator('#burndown circle[data-day="2026-03-10"]').getAttribute('data-remaining'), '12', 'yesterday is unchanged');
  });
  await run('un-finishing, deleting and completing everything', async () => {
    await page.locator('[data-task="Login"] input[type=checkbox]').uncheck(); await page.waitForFunction(() => document.querySelectorAll('#done [data-task]').length === 0); assert.equal(await text('#status'), 'behind');
    await page.getByRole('button', { name: 'Delete Docs' }).click(); await page.waitForFunction(() => !document.querySelector('[data-task="Docs"]'));
    for (const t of ['Login', 'Signup', 'Emails', 'Urgent bug']) await page.locator(`[data-task="${t}"] input[type=checkbox]`).check(); await page.waitForFunction(() => document.getElementById('status').textContent === 'complete'); assert.match(await text('#forecast'), /All work is done/);
  });
  await run('sprint list shows status; delete sprint', async () => {
    await page.locator('#nav-sprints').click(); await page.locator('[data-sprint="Sprint 1"]').waitFor(); assert.match(await text('[data-sprint="Sprint 1"]'), /complete.*0 of 18 pts left/s); await page.locator('[data-sprint]').click(); await page.locator('#delete').click(); await page.getByText('No sprints yet').waitFor();
  });
  await run('mobile: no horizontal overflow', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); await page.locator('#name').fill('S'); await page.locator('#end').fill('2026-03-20'); await page.getByRole('button', { name: 'Create sprint' }).click(); await page.locator('#burndown').waitFor(); await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.goto(url); await page.waitForTimeout(200); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
