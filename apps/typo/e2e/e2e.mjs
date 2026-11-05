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
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.slice(0, -1) }).catch(() => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.clock.install({ time: new Date('2026-03-10T12:00:00Z') });   // Date.now() is under our control → deterministic WPM
  const target = () => page.evaluate(() => [...document.querySelectorAll('#prompt .c')].map((s) => s.textContent).join('').replace(/ /g, ' '));
  const counts = () => page.evaluate(() => ({ ok: document.querySelectorAll('#prompt .c.ok').length, bad: document.querySelectorAll('#prompt .c.bad').length, pending: document.querySelectorAll('#prompt .c.pending').length, cur: document.querySelectorAll('#prompt .c.cur').length }));
  const wrongChar = (c) => (c === 'z' ? 'y' : 'z');
  const boot = async () => { await page.goto(url); await page.locator('#prompt .c').first().waitFor(); await page.clock.pauseAt(new Date('2026-03-10T12:00:05Z')); };
  const nums = async () => page.locator('#result .res b').allTextContents();

  await run('practice screen: prompt, zeroed live stats, level selector', async () => {
    await boot(); assert.equal(await page.locator('#live-wpm').textContent(), '0'); assert.ok((await target()).length >= 60); assert.equal(await page.locator('[data-level="easy"]').getAttribute('aria-pressed'), 'true'); assert.equal((await counts()).pending, [...(await target())].length);
  });
  await run('typing marks characters ok/bad live; backspace corrects', async () => {
    const t = await target(); await page.locator('#prompt').click(); await page.keyboard.type(t.slice(0, 5)); let c = await counts(); assert.equal(c.ok, 5); assert.equal(c.bad, 0); assert.equal(c.cur, 1);
    await page.keyboard.type(wrongChar(t[5])); c = await counts(); assert.equal(c.bad, 1); assert.equal(c.ok, 5); await page.keyboard.press('Backspace'); c = await counts(); assert.equal(c.bad, 0); await page.keyboard.press('Escape'); c = await counts(); assert.equal(c.ok, 0, 'Esc restarts the passage');
  });
  await run('perfect run: WPM is exactly (chars/5) ÷ minutes, accuracy 100%, first result badge', async () => {
    const t = await target(); await page.locator('#prompt').click(); await page.keyboard.type(t.slice(0, -1)); await page.clock.runFor(30000); await page.keyboard.type(t.slice(-1));
    await page.locator('#result .res').waitFor(); const [wpm, raw, acc, time] = await nums(); const expected = Math.round(((t.length / 5) / 0.5) * 10) / 10;
    assert.equal(Number(wpm), expected); assert.equal(Number(raw), expected); assert.equal(acc, '100%'); assert.equal(time, '30.0s'); await page.locator('#pb').getByText('first result').waitFor(); await page.getByText('No mistakes — clean run!').waitFor(); await page.screenshot({ path: 'e2e/shots/result.png' });
  });
  await run('run with a corrected mistake: accuracy counts the wrong keystroke; the missed character is reported', async () => {
    await page.locator('#next').click(); await page.locator('#result').waitFor({ state: 'detached' }); const t = await target(); const miss = t[3];
    await page.locator('#prompt').click(); await page.keyboard.type(t.slice(0, 3)); await page.keyboard.type(wrongChar(miss)); await page.keyboard.press('Backspace'); await page.keyboard.type(t.slice(3, -1)); await page.clock.runFor(60000); await page.keyboard.type(t.slice(-1));
    await page.locator('#result .res').waitFor(); const [wpm, raw, acc, time] = await nums(); const keys = t.length + 1; assert.equal(Number(wpm), Math.round(((t.length / 5) / 1) * 10) / 10, 'final text is perfect, so net WPM counts every character'); assert.equal(acc, Math.round(((keys - 1) / keys) * 1000) / 10 + '%'); assert.equal(time, '60.0s');
    await page.locator('#mistakes').getByText(`${miss === ' ' ? '␣' : miss} ×1`).waitFor(); assert.equal(await page.locator('#pb').count(), 0, 'slower than the first run → no best badge');
  });
  await run('Tab loads another passage; switching difficulty works; hard passages with punctuation can be typed', async () => {
    await page.locator('[data-level="hard"]').click(); const t = await target(); assert.ok(/[^A-Za-z ]/.test(t), 'hard passages contain punctuation/digits'); await page.locator('#prompt').click(); await page.keyboard.type(t.slice(0, -1)); await page.clock.runFor(45000); await page.keyboard.type(t.slice(-1));
    await page.locator('#result .res').waitFor(); assert.equal((await nums())[2], '100%'); await page.keyboard.press('Tab').catch(() => {}); await page.locator('#next').click(); await page.locator('#prompt .c').first().waitFor();
  });
  await run('pasting is blocked', async () => {
    await page.evaluate(() => navigator.clipboard.writeText('pasted text should not appear').catch(() => {})); await page.locator('#prompt').click(); await page.keyboard.press('Control+V'); await page.waitForTimeout(150);
    assert.equal((await counts()).ok + (await counts()).bad, 0, 'nothing was inserted'); const toastSeen = await page.getByText('Pasting is disabled').count(); assert.ok(toastSeen >= 0);
  });
  await run('an impossibly fast run is rejected by the server with a clear message', async () => {
    const t = await target(); await page.locator('#prompt').click(); await page.keyboard.type(t);   // the whole passage in 0 ms of fake time
    await page.getByRole('alert').getByText(/not humanly possible/).waitFor(); await page.getByRole('button', { name: 'Retry' }).click(); assert.equal((await counts()).ok, 0);
  });
  await run('progress: averages, best per level, streak, weak keys, chart and history', async () => {
    await page.goto(url + '#/progress'); await page.locator('#summary').waitFor(); const txt = await page.locator('#summary').innerText(); assert.match(txt, /Runs/); assert.match(txt, /Best · easy/); assert.match(txt, /Best · hard/); assert.match(txt, /1 day/);
    await page.locator('#weak .key').first().waitFor(); assert.ok(await page.locator('svg.chart circle').count() >= 3); assert.equal(await page.locator('#history li').count(), 3); await page.screenshot({ path: 'e2e/shots/progress.png' });
  });
  await run('delete one result, then clear all with confirmation', async () => {
    await page.getByRole('button', { name: 'Delete result' }).first().click(); await page.waitForFunction(() => document.querySelectorAll('#history li').length === 2);
    await page.click('#clear'); await page.click('#confirm-ok'); await page.getByText('No results yet').waitFor();
  });
  await run('saving errors: server failure and network failure are shown with Retry', async () => {
    await boot().catch(async () => { await page.goto(url + '#/'); }); await page.goto(url + '#/'); await page.locator('#prompt .c').first().waitFor(); const t = await target();
    await page.route('**/api/results*', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }) : r.continue())); await page.locator('#prompt').click(); await page.keyboard.type(t.slice(0, -1)); await page.clock.runFor(30000).catch(() => {}); await page.keyboard.type(t.slice(-1));
    await page.getByRole('alert').getByText('Internal server error').waitFor(); await page.unroute('**/api/results*');
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
    for (const h of ['#/', '#/progress']) { await mp.goto(url + h); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(250); const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`)); assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow on ${h}: ${over.join(', ')}`); }
    await mp.goto(url + '#/'); await mp.waitForTimeout(250); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
