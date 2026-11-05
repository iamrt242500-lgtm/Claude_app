import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp(); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  const text = (s) => page.locator(s).textContent();
  const score = async (match, a, b) => { const card = page.locator(`[data-round="${match[0]}"][data-idx="${match[1]}"]`); await card.locator('[data-score=a]').fill(String(a)); await card.locator('[data-score=b]').fill(String(b)); await card.locator('[data-save]').click(); };
  const create = async (name, format, players) => { await page.goto(url + '#/new'); await page.locator('#tname').fill(name); await page.locator('#tformat').selectOption(format); await page.locator('#tplayers').fill(players.join('\n')); await page.locator('#create').click(); await page.locator('#progress').waitFor(); };
  await run('empty list; creation form shows a live player count and validates', async () => {
    await page.goto(url); await page.getByText('No tournaments yet').waitFor(); await page.locator('#nav-new').click(); await page.locator('#tplayers').fill('Ann\nBob\n\nCy'); assert.equal(await text('#pcount'), '3 players');
    await page.locator('#tname').fill('x'); await page.locator('#tplayers').fill('Ann\nann'); await page.locator('#create').click(); await page.locator('#form-error').getByText('unique').waitFor();
  });
  await run('knockout with 6 players: top seeds get byes and appear in round 2', async () => {
    await create('Club cup', 'knockout', ['Ann', 'Bob', 'Cy', 'Di', 'Ed', 'Flo']); assert.equal(await page.locator('.col').count(), 3); assert.equal(await page.locator('.col').first().locator('h3').textContent(), 'Quarterfinals');
    assert.equal(await page.locator('.byebadge').count(), 2); assert.match(await text('.byebadge >> nth=0'), /Ann advances \(bye\)/); assert.match(await text('.byebadge >> nth=1'), /Bob advances/);
    assert.match(await text('[data-round="1"][data-idx="0"]'), /Ann/);
  });
  await run('entering results moves winners forward; draws are rejected; champion shown', async () => {
    await score([0, 1], 2, 2); await page.getByText('can’t end in a draw').waitFor(); await score([0, 1], 3, 1); await page.waitForFunction(() => /Di/.test(document.querySelector('[data-round="1"][data-idx="0"]').textContent));   // seed 4 beats seed 5
    await score([0, 3], 0, 1); await page.waitForFunction(() => /Flo/.test(document.querySelector('[data-round="1"][data-idx="1"]').textContent));
    await score([1, 0], 5, 0); await page.waitForFunction(() => /Ann/.test(document.querySelector('[data-round="2"][data-idx="0"]').textContent)); await score([1, 1], 1, 2);
    await page.waitForFunction(() => /Flo/.test(document.querySelector('[data-round="2"][data-idx="0"]').textContent)); await score([2, 0], 1, 0); await page.locator('#champion').waitFor(); assert.match(await text('#champion'), /Ann/); assert.match(await text('#progress'), /5\/5 matches/);
  });
  await run('a played match can be corrected; moving the winner is blocked once it advanced', async () => {
    await score([0, 1], 0, 4); await page.getByText('already advanced').waitFor();
  });
  await run('round robin: fixtures, standings update, tie broken by goal difference', async () => {
    await create('League', 'roundrobin', ['A', 'B', 'C']); assert.equal(await page.locator('.fixtures .match').count(), 3);
    const sel = (a, b) => page.locator('.match', { has: page.locator(`.side:has-text("${a}")`) }).filter({ has: page.locator(`.side:has-text("${b}")`) });
    const play = async (a, b, sa, sb) => { const card = sel(a, b).first(); const [firstA] = (await card.locator('.side span').allTextContents()); const flip = firstA !== a; await card.locator('[data-score=a]').fill(String(flip ? sb : sa)); await card.locator('[data-score=b]').fill(String(flip ? sa : sb)); await card.locator('[data-save]').click(); await page.waitForTimeout(150); };
    await play('A', 'B', 2, 0); await play('A', 'C', 1, 1); await play('B', 'C', 0, 3);
    await page.waitForFunction(() => document.querySelectorAll('[data-clear]').length === 3); const rows = await page.locator('#standings tbody tr').evaluateAll((rs) => rs.map((r) => [r.children[1].textContent, r.lastElementChild.textContent])); assert.deepEqual(rows, [['C', '4'], ['A', '4'], ['B', '0']]); await page.locator('#champion').waitFor(); assert.match(await text('#champion'), /C/);
  });
  await run('clearing a result removes it from the table; list shows progress; delete', async () => {
    await page.locator('[data-clear]').first().click(); await page.waitForFunction(() => document.querySelectorAll('[data-clear]').length === 2); assert.equal(await page.locator('#champion').count(), 0);
    await page.goto(url); await page.locator('[data-t]').first().waitFor(); assert.match(await text('[data-t] >> nth=0'), /2\/3 played/); await page.locator('[data-t]').first().click(); await page.locator('#delete').click(); await page.waitForFunction(() => document.querySelectorAll('[data-t]').length === 1);
  });
  await run('mobile: the bracket scrolls inside its container; no page overflow', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); await page.goto(url); await page.locator('[data-t]').first().click(); await page.locator('#bracket').waitFor(); await page.waitForTimeout(200); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
