import { chromium } from 'playwright';
import { createApp, answerFor } from '../src/server.js';
import { score, dayIndex } from '../src/game.js';
import { ANSWERS } from '../src/words.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp({ now: () => new Date('2026-03-11T10:00:00Z') }); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const answer = answerFor(dayIndex('2026-03-11')), wrong = ANSWERS.filter((w) => w !== answer);
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const ctx = await browser.newContext({ viewport: { width: 700, height: 900 }, timezoneId: 'UTC' }); await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.slice(0, -1) }).catch(() => {});
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.clock.install({ time: new Date('2026-03-11T10:00:00Z') });
  const states = (row) => page.locator(`[data-row="${row}"]`).evaluateAll((els) => els.map((e) => e.dataset.state || '').join(''));
  const submit = async (w) => { await page.keyboard.type(w); await page.keyboard.press('Enter'); };
  await run('typing fills tiles; backspace removes; short guess is rejected with a message', async () => {
    await page.goto(url); await page.locator('.tile').first().waitFor(); await page.keyboard.type('abo'); assert.equal(await page.locator('[data-row="0"][data-filled]').count(), 3); await page.keyboard.press('Backspace'); assert.equal(await page.locator('[data-row="0"][data-filled]').count(), 2);
    await page.keyboard.press('Enter'); await page.getByText('Not enough letters').waitFor(); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  });
  await run('unknown word is rejected without using an attempt', async () => {
    await submit('zzzzz'); await page.getByText('Not in the word list').waitFor(); assert.equal(await states(0), '');
    for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  });
  await run('valid guess is coloured exactly like the reference scorer; keyboard keys update', async () => {
    const w = wrong[0]; await submit(w); await page.waitForFunction(() => document.querySelector('[data-row="0"]').dataset.state); assert.equal(await states(0), score(w, answer));
    const res = score(w, answer); for (let i = 0; i < 5; i++) { const k = await page.locator(`[data-key="${w[i]}"]`).getAttribute('data-state'); assert.ok(k, w[i]); if (res[i] === 'g') assert.equal(k, 'g'); }
  });
  await run('a duplicate guess is rejected', async () => { await submit(wrong[0]); await page.getByText('already tried').waitFor(); for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace'); });
  await run('reload keeps progress (cookie identifies the player); the answer is never in the page', async () => {
    await page.reload(); await page.waitForFunction(() => document.querySelector('[data-row="0"]').dataset.state); assert.equal(await states(0), score(wrong[0], answer)); assert.ok(!(await page.content()).includes(`>${answer}<`));
  });
  await run('winning: banner, share text, stats', async () => {
    await submit(answer); await page.locator('#outcome').getByText('Solved in 2/6').waitFor(); assert.equal(await states(1), 'ggggg');
    await page.locator('#share').click(); const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null); if (clip !== null) { assert.match(clip, /^Lexi 2026-03-11 2\/6\n/); assert.match(clip, /🟩🟩🟩🟩🟩$/); }
    await page.locator('#nav-stats').click(); await page.locator('#stats').waitFor(); assert.match((await page.locator('#stats').textContent()).replace(/\s/g, ''), /^1Played100Win%1Streak1Best$/); assert.equal(await page.locator('[data-bar="2"] .fill').textContent(), '1');
    await page.locator('.btn', { hasText: 'Back to the game' }).click(); await page.locator('#outcome').waitFor(); await page.keyboard.type('abc'); assert.equal(await page.locator('[data-filled]:not([data-state])').count(), 0, 'no typing after the game ends');
  });
  await run('losing in a fresh context reveals the answer', async () => {
    const p2 = await (await browser.newContext({ viewport: { width: 700, height: 900 }, timezoneId: 'UTC' })).newPage(); await p2.goto(url); await p2.locator('.tile').first().waitFor();
    for (const [i, w] of wrong.slice(0, 6).entries()) { await p2.keyboard.type(w); await p2.keyboard.press('Enter'); await p2.waitForFunction((r) => document.querySelector(`[data-row="${r}"]`).dataset.state, i); }
    await p2.locator('#outcome').getByText(`The word was ${answer.toUpperCase()}`).waitFor();
  });
  await run('on-screen keyboard works and mobile has no overflow', async () => {
    const p3 = await (await browser.newContext({ viewport: { width: 360, height: 700 }, timezoneId: 'UTC' })).newPage(); await p3.goto(url); await p3.locator('.key').first().waitFor();
    for (const c of wrong[1]) await p3.locator(`[data-key="${c}"]`).click(); await p3.locator('[data-key="enter"]').click(); await p3.waitForFunction(() => document.querySelector('[data-row="0"]').dataset.state);
    assert.ok(await p3.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await p3.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
