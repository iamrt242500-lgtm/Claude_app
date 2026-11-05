import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp({ now: () => new Date('2026-03-31T12:00:00Z') }); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
const put = (day, b) => fetch(`${url}api/entries/${day}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
try {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, timezoneId: 'UTC' }); const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date('2026-03-31T12:00:00Z') });
  const text = (s) => page.locator(s).textContent();
  await run('empty insights state', async () => { await page.goto(url + '#/insights'); await page.locator('#no-data').waitFor(); });
  await run('log today: radios, validation message when mood is missing, save lands in history', async () => {
    await page.goto(url); await page.locator('#fs-mood').waitFor(); assert.equal(await page.locator('#day').inputValue(), '2026-03-31');
    await page.locator('#save').click(); await page.locator('#form-error').getByText('Mood must be').waitFor();
    await page.locator('label:has(#mood-4)').click(); await page.locator('label:has(#energy-3)').click(); await page.locator('#sleep').fill('7.5'); await page.locator('#tags').fill('#Run, late night'); await page.locator('#note').fill('<b>nice</b> run');
    await page.locator('#save').click(); await page.locator('[data-day="2026-03-31"]').waitFor(); const c = await text('[data-day="2026-03-31"]'); assert.match(c, /Mood 4 Good/); assert.match(c, /7.5 h sleep/); assert.match(c, /#run/); assert.match(c, /#late-night/); assert.match(c, /<b>nice<\/b> run/); assert.equal(await page.locator('[data-day] b').count(), 0, 'note is text, not markup');
  });
  await run('editing an entry prefills the form and updates in place (no duplicate)', async () => {
    await page.locator('[data-day="2026-03-31"] a', { hasText: 'Edit' }).click(); await page.locator('#fs-mood').waitFor(); assert.ok(await page.locator('#mood-4').isChecked()); assert.equal(await page.locator('#sleep').inputValue(), '7.5');
    await page.locator('label:has(#mood-5)').click(); await page.locator('#save').click(); await page.locator('[data-day]').first().waitFor(); assert.equal(await page.locator('[data-day]').count(), 1); assert.match(await text('[data-day]'), /Mood 5 Great/);
  });
  await run('backfill an older day via the date picker; future dates are capped', async () => {
    await page.goto(url + '#/'); await page.locator('#day').fill('2026-03-30'); await page.locator('#fs-mood').waitFor(); await page.waitForFunction(() => location.hash.includes('2026-03-30'));
    await page.locator('label:has(#mood-2)').click(); await page.locator('label:has(#energy-2)').click(); await page.locator('#save').click(); await page.locator('[data-day="2026-03-30"]').waitFor(); assert.equal(await page.locator('#day, input[type=date]').count(), 0);
    await page.goto(url + '#/'); assert.equal(await page.locator('#day').getAttribute('max'), '2026-03-31');
  });
  await run('seed two weeks of data; insights shows chart, tag table and correlation', async () => {
    for (let i = 0; i < 14; i++) { const day = `2026-03-${String(15 + i).padStart(2, '0')}`, run = i % 2 === 0, mood = run ? 5 : 2 + (i % 3 === 0 ? 1 : 0); const r = await put(day, { mood, energy: mood, sleep: 4 + mood, tags: run ? ['run'] : [] }); assert.equal(r.status, 201); }
    await page.goto(url + '#/insights'); await page.locator('#chart').waitFor(); assert.ok(await page.locator('#chart circle').count() >= 16); assert.ok((await page.locator('#mood-line').getAttribute('d')).includes('M')); await page.locator('#avg-line').waitFor();
    assert.match(await text('#corr'), /Sleep ↔ mood: strong positive link/); const row = page.locator('[data-tag="run"]'); await row.waitFor(); assert.match(await row.textContent(), /\+\d\.\d\d/); assert.ok(await row.locator('td.pos').count());
    assert.match(await text('#summary'), /Logged/); assert.equal(await page.locator('#weekday .cell').count(), 7);
  });
  await run('range selector changes the window', async () => {
    await page.locator('#range').selectOption('7'); await page.waitForFunction(() => location.hash.includes('days=7')); await page.waitForFunction(() => /Last 7 days/.test(document.getElementById('range').selectedOptions[0].textContent)); assert.match(await text('#summary'), /\d+\/7/);
  });
  await run('delete an entry', async () => {
    await page.goto(url + '#/history'); const before = await page.locator('[data-day]').count(); await page.locator('[data-day="2026-03-15"] button').click(); await page.waitForFunction((n) => document.querySelectorAll('[data-day]').length === n, before - 1);
  });
  await run('mobile: no horizontal overflow on any screen', async () => {
    await page.setViewportSize({ width: 360, height: 700 }); for (const h of ['#/', '#/history', '#/insights']) { await page.goto(url + h); await page.waitForTimeout(200); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); }
    await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
