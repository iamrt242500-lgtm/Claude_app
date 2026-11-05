import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp({ now: () => new Date('2026-03-11T10:00:00Z') });
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
const NOTES = 'Attendees: Sam, Priya\nTODO: update the budget sheet by Friday\nSam will draft the <b>announcement</b> by end of week\nPriya to send the proposal next Tuesday\nWe need to decide on pricing\n';
try {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, timezoneId: 'UTC' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.clock.install({ time: new Date('2026-03-11T10:00:00Z') });
  page.on('dialog', (d) => d.accept());

  await run('empty state', async () => { await page.goto(url); await page.getByText('No tasks here').waitFor(); });
  await run('live preview extracts as you type, with owners and resolved dates; no HTML injection', async () => {
    await page.locator('#nav-new').click(); await page.locator('#title').fill('Weekly sync'); await page.locator('#notes').fill(NOTES);
    await page.locator('[data-preview]').first().waitFor(); assert.equal(await page.locator('[data-preview]').count(), 4);
    const txt = await page.locator('#preview').textContent(); assert.match(txt, /Fri, Mar 13/); assert.match(txt, /@Priya/); assert.match(txt, /Tue, Mar 17/); assert.match(txt, /@Sam/);
    assert.equal(await page.locator('#preview b').count(), 0, 'markup in notes must stay text');
    await page.locator('#day').fill('2026-03-18'); await page.waitForFunction(() => /Fri, Mar 20/.test(document.getElementById('preview').textContent));   // live: changing the meeting date moves the due dates
    await page.locator('#day').fill('2026-03-11');
  });
  await run('save: meeting page lists tasks; notes rendered as text', async () => {
    await page.locator('#save').click(); await page.getByRole('heading', { name: 'Weekly sync' }).waitFor(); assert.equal(await page.locator('[data-task]').count(), 4);
    assert.match(await page.locator('#raw-notes').textContent(), /<b>announcement<\/b>/); assert.equal(await page.locator('#raw-notes b').count(), 0);
  });
  await run('task board groups by due bucket relative to today; counts shown', async () => {
    await page.locator('.brand').click(); await page.locator('[data-bucket="week"]').waitFor();
    assert.equal(await page.locator('[data-bucket="week"] [data-task]').count(), 3, 'Fri, EOW and Tue (within 7 days)'); assert.equal(await page.locator('[data-bucket="later"] [data-task]').count(), 0); assert.equal(await page.locator('[data-bucket="none"] [data-task]').count(), 1);
    assert.match(await page.locator('#summary').textContent(), /4 open · 0 overdue · 0 due today/);
  });
  await run('completing a task moves it to Done and persists across reload; filters work', async () => {
    await page.locator('[data-bucket="none"] input[type=checkbox]').check(); await page.locator('[data-bucket="none"]').waitFor({ state: 'detached' }); assert.match(await page.locator('#summary').textContent(), /3 open/);
    await page.reload(); assert.match(await page.locator('#summary').textContent(), /3 open/);
    await page.locator('#owner-filter').selectOption('Priya'); await page.waitForFunction(() => document.querySelectorAll('[data-task]').length === 1); assert.match(await page.locator('[data-task]').textContent(), /proposal/);
    await page.locator('#status-filter').selectOption('all'); await page.waitForFunction(() => location.hash.includes('status=all')); await page.locator('#owner-filter').selectOption(''); await page.waitForFunction(() => document.querySelectorAll('[data-task]').length === 4);
  });
  await run('quick add parses owner and date; validation of the date is server-side', async () => {
    await page.locator('#quick-text').fill('@Lee to book the venue tomorrow'); await page.getByRole('button', { name: 'Add' }).click(); await page.locator('[data-task]', { hasText: 'venue' }).waitFor();
    const row = page.locator('[data-task]', { hasText: 'venue' }); assert.match(await row.textContent(), /@Lee/); assert.match(await row.textContent(), /Thu, Mar 12/);
  });
  await run('editing notes keeps completed state; removed lines drop their tasks', async () => {
    await page.goto(url + '#/meetings'); await page.locator('[data-meeting]').click(); await page.getByRole('link', { name: 'Edit notes' }).click(); await page.locator('#notes').waitFor();
    await page.locator('#notes').fill(NOTES.replace('Priya to send the proposal next Tuesday\n', '')); await page.locator('#save').click(); await page.getByRole('heading', { name: 'Weekly sync' }).waitFor();
    assert.equal(await page.locator('[data-task]').count(), 3); assert.equal(await page.locator('[data-task].done').count(), 1);
  });
  await run('validation error shown on the form', async () => {
    await page.goto(url + '#/new'); await page.locator('#title').fill('x'); await page.locator('#day').fill(''); await page.locator('#save').click(); await page.locator('#form-error').getByText('Date must be').waitFor();
  });
  await run('delete meeting removes it and its tasks', async () => {
    await page.goto(url + '#/meetings'); await page.locator('[data-meeting]').click(); await page.getByRole('link', { name: 'Edit notes' }).click(); await page.locator('#delete').click(); await page.getByText('No meetings yet').waitFor();
    await page.goto(url); await page.locator('[data-task]', { hasText: 'venue' }).waitFor(); assert.equal(await page.locator('[data-task]').count(), 1, 'only the manual task remains');
  });
  await run('mobile: no horizontal overflow on any screen', async () => {
    await page.setViewportSize({ width: 360, height: 700 });
    for (const h of ['#/', '#/meetings', '#/new']) { await page.goto(url + h); await page.waitForTimeout(150); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); }
    await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; '));
  console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
