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
  const logPage = async (day, p) => { await page.locator('#day').fill(day); await page.locator('#page').fill(String(p)); await page.locator('#log').click(); await page.getByText('Logged').waitFor(); await page.getByText('Logged').waitFor({ state: 'detached' }); };
  await run('add a book (validation first)', async () => {
    await page.goto(url); await page.getByText('No books here yet').waitFor(); await page.getByRole('button', { name: 'Add book' }).click(); await page.locator('#form-error').getByText('Title is required').waitFor();
    await page.locator('#title').fill('Emma'); await page.locator('#author').fill('Jane Austen'); await page.locator('#pages').fill('300'); await page.getByRole('button', { name: 'Add book' }).click(); await page.locator('#eta').waitFor(); assert.equal(await text('#eta'), 'Not started');
  });
  await run('logging pages updates progress, pace and the finish estimate', async () => {
    await logPage('2026-03-12', 60); await logPage('2026-03-13', 90); await logPage('2026-03-15', 150);
    assert.match(await text('#status'), /150\/300 pages · 50%/); assert.match(await text('#eta'), /14 days left at 10\.7 pages\/day → Mar 29, 2026/); assert.equal(await page.locator('#logs li').count(), 3); assert.match(await text('#logs li >> nth=0'), /page 150 \(\+60\)/);
    assert.equal(await page.locator('.bar i').evaluate((e) => e.style.width), '50%');
  });
  await run('invalid pages and future days are rejected with a message', async () => {
    await page.evaluate(() => document.getElementById('page').removeAttribute('max')); await page.locator('#page').fill('301'); await page.locator('#log').click(); await page.locator('#form-error').getByText('0 to 300').waitFor(); await page.locator('#page').fill('200'); await page.locator('#day').fill('2026-03-15'); await page.evaluate(() => { document.getElementById('day').removeAttribute('max'); }); await page.locator('#day').fill('2026-03-16'); await page.locator('#log').click(); await page.locator('#form-error').getByText('future').waitFor();
  });
  await run('finishing a book marks it finished; rating works; deleting the last log reopens it', async () => {
    await logPage('2026-03-15', 300); await page.waitForFunction(() => /Finished Mar 15, 2026/.test(document.getElementById('eta').textContent)); await page.locator('#rating').selectOption('4'); await page.getByText('Saved').waitFor();
    await page.locator('#logs li[data-day="2026-03-15"] button').click(); await page.waitForFunction(() => !/Finished/.test(document.getElementById('eta').textContent)); await logPage('2026-03-15', 300);
  });
  await run('shelf filters by status; a second book is “to read”', async () => {
    await page.goto(url); await page.locator('#title').fill('Dune'); await page.locator('#pages').fill('600'); await page.getByRole('button', { name: 'Add book' }).click(); await page.locator('#eta').waitFor(); await page.goto(url + '#/?f=finished'); await page.locator('[data-book="Emma"]').waitFor(); assert.equal(await page.locator('[data-book]').count(), 1);
    await page.locator('[data-filter="to-read"]').click(); await page.locator('[data-book="Dune"]').waitFor(); assert.equal(await page.locator('[data-book]').count(), 1);
  });
  await run('stats: chart bars match the log, streak and goal pace', async () => {
    await page.locator('#nav-stats').click(); await page.locator('#chart').waitFor(); assert.equal(await page.locator('#chart rect').count(), 30); assert.equal(await page.locator('#chart rect[data-day="2026-03-13"]').getAttribute('data-pages'), '30'); assert.equal(await page.locator('#chart rect[data-day="2026-03-15"]').getAttribute('data-pages'), '210');
    assert.match(await text('#summary'), /1 d.*Streak|Streak/s); assert.match(await text('#pace'), /1 of 12 books finished — behind \(1\.4 books behind the 2\.4 expected by today\)/);
    await page.locator('#goal').fill('2'); await page.locator('#save-goal').click(); await page.waitForFunction(() => /ahead/.test(document.getElementById('pace').textContent));
  });
  await run('mobile: no horizontal overflow', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); for (const h of ['#/', '#/book/1', '#/stats']) { await page.goto(url + h); await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); } await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
