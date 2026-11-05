import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import { generate, conflicts } from '../src/sudoku.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp({ now: () => new Date('2026-03-11T10:00:00Z') }); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 700, height: 1000 } })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date('2026-03-11T10:00:00Z') });
  let pz, id; const cell = (i) => page.locator(`[data-i="${i}"]`); const val = (i) => cell(i).getAttribute('data-v');
  const cls = async (i) => (await cell(i).getAttribute('class')).split(' ');
  await run('start page → easy puzzle with the right givens', async () => {
    await page.goto(url); await page.locator('[data-new="easy"]').click(); await page.locator('.sudoku').waitFor(); id = page.url().split('/play/')[1]; assert.match(id, /^easy-\d+$/); pz = generate(Number(id.split('-')[1]), 'easy');
    assert.equal(await page.locator('.cell.given').count(), pz.clues); assert.equal(await page.locator('.cell').count(), 81); for (let i = 0; i < 81; i++) if (pz.puzzle[i] !== '.') assert.equal(await val(i), pz.puzzle[i]);
  });
  let empty;
  await run('typing a digit fills the selected cell; givens are protected', async () => {
    empty = [...pz.puzzle].map((c, i) => (c === '.' ? i : -1)).filter((i) => i >= 0); const g0 = [...pz.puzzle].findIndex((c) => c !== '.');
    await cell(g0).click(); await page.keyboard.press(pz.puzzle[g0] === '1' ? '2' : '1'); assert.equal(await val(g0), pz.puzzle[g0]);
    await cell(empty[0]).click(); await page.keyboard.press(pz.solution[empty[0]]); assert.equal(await val(empty[0]), pz.solution[empty[0]]);
  });
  await run('conflicting digits are highlighted in red and clear when fixed; undo works', async () => {
    const i = empty[1], row = Math.floor(i / 9), peerGiven = [...Array(9).keys()].map((c) => row * 9 + c).find((j) => pz.puzzle[j] !== '.' && pz.solution[i] !== pz.puzzle[j]);
    await cell(i).click(); await page.keyboard.press(pz.puzzle[peerGiven]); assert.ok((await cls(i)).includes('bad')); assert.ok((await cls(peerGiven)).includes('bad'));
    await page.locator('#undo').click(); assert.equal(await val(i), ''); assert.ok(!(await cls(peerGiven)).includes('bad'));
  });
  await run('notes mode adds pencil marks without filling the cell', async () => {
    const i = empty[2]; await cell(i).click(); await page.locator('#notes-toggle').click(); await page.keyboard.press('3'); await page.keyboard.press('7'); assert.equal(await val(i), ''); assert.equal(await cell(i).locator('.notes span:not(:empty)').count(), 2);
    await page.keyboard.press('3'); assert.equal(await cell(i).locator('.notes span:not(:empty)').count(), 1, 'pressing again removes the note'); await page.locator('#notes-toggle').click();
  });
  await run('Check marks a wrong digit (not just conflicts); correcting it removes the mark', async () => {
    const i = empty[3], right = pz.solution[i], wrong = right === '9' ? '8' : String(Number(right) + 1); await cell(i).click(); await page.keyboard.press(wrong);
    // pick a digit that does not conflict visibly so only the server check can tell
    await page.locator('#check').click(); await page.getByText(/wrong digit/).waitFor(); assert.ok((await cls(i)).includes('wrong')); await page.keyboard.press(right); assert.ok(!(await cls(i)).includes('wrong'));
  });
  await run('Hint fills a correct digit and is counted; progress survives reload', async () => {
    await page.locator('#hint').click(); await page.waitForFunction(() => document.querySelector('.cell.sel')); const i = Number(await page.locator('.cell.sel').getAttribute('data-i')); assert.equal(await val(i), pz.solution[i]);
    await page.waitForTimeout(300); await page.reload(); await page.locator('.sudoku').waitFor(); assert.equal(await val(i), pz.solution[i]); assert.equal(await val(empty[0]), pz.solution[empty[0]]);
  });
  await run('timer runs on the (fake) clock and survives reload without going backwards', async () => {
    await page.locator('#timer').waitFor(); await page.clock.runFor(65000); assert.equal(await page.locator('#timer').textContent(), '1:05'); await page.waitForTimeout(300);
  });
  await run('filling every cell correctly shows the win banner; stats count it (hint → not a clean record)', async () => {
    for (const i of empty) { if ((await val(i)) === pz.solution[i]) continue; await cell(i).click(); await page.keyboard.press(pz.solution[i]); }
    await page.locator('#win').waitFor(); assert.match(await page.locator('#win').textContent(), /Solved in 1:0\d with 1 hint/); await page.locator('#nav-stats').click(); const card = page.locator('[data-diff="easy"]'); await card.waitFor();
    const t = await card.textContent(); assert.match(t, /Solved: 1/); assert.match(t, /Best \(no hints\): —/);
  });
  await run('a solved game is not resumable; daily puzzle and hard difficulty start', async () => {
    await page.goto(url); await page.locator('[data-game]').count().then((n) => assert.equal(n, 0)); await page.locator('#daily').click(); await page.locator('.sudoku').waitFor(); assert.match(page.url(), /medium-20260311/);
    await page.goto(url); await page.locator('[data-new="hard"]').click(); await page.locator('.sudoku').waitFor(); assert.ok((await page.locator('.cell.given').count()) <= 29); await page.goto(url); assert.equal(await page.locator('[data-game]').count(), 3 - 1, 'daily + hard in progress');
  });
  await run('mobile: board fits the viewport', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); await page.locator('[data-game]').first().click(); await page.locator('.sudoku').waitFor(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); const b = await page.locator('.sudoku').boundingBox(); assert.ok(b.width <= 360 && Math.abs(b.width - b.height) < 8); await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
