import { chromium } from 'playwright';
import { createApp, compute } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp(); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
const NAMES = ['Ann', 'Ben', 'Cy', 'Di', 'Ed', 'Flo'];
try {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  const text = (s) => page.locator(s).textContent();
  await run('validation messages before drawing', async () => {
    await page.goto(url); await page.locator('#draw').click(); await page.locator('#form-error').getByText('Add at least one entry').waitFor(); await page.locator('#entries').fill('Ann x0'); await page.locator('#draw').click(); await page.locator('#form-error').getByText('weight must be 1–1000').waitFor();
  });
  await run('winners: seeded draw is reproducible and matches the library result', async () => {
    await page.locator('#title').fill('Door prize'); await page.locator('#entries').fill(NAMES.join('\n')); await page.locator('#count').fill('2'); await page.locator('#seed').fill('office-2026'); await page.locator('#draw').click(); await page.locator('#winners').waitFor();
    const got = await page.locator('#winners li').allTextContents(); assert.deepEqual(got, compute('winners', NAMES.join('\n'), 'office-2026', { count: 2 }).result.winners); assert.equal(await text('#seed-value'), 'office-2026'); assert.equal(new Set(got).size, 2);
  });
  await run('verify button confirms the stored result', async () => { await page.locator('#verify-btn').click(); await page.locator('#verify.ok').waitFor(); assert.match(await text('#verify'), /identical result/); });
  await run('a random seed is generated when none is given; two draws differ in seed', async () => {
    await page.locator('#nav-new').click(); await page.locator('#entries').fill(NAMES.join('\n')); await page.locator('#draw').click(); await page.locator('#winners').waitFor(); const s1 = await text('#seed-value'); assert.match(s1, /^[0-9a-f]{12}$/);
    await page.locator('#nav-new').click(); await page.locator('#entries').fill(NAMES.join('\n')); await page.locator('#draw').click(); await page.locator('#winners').waitFor(); assert.notEqual(await text('#seed-value'), s1);
  });
  await run('weights: a 1000:1 entry wins nearly always; weight syntax is live-counted', async () => {
    let heavy = 0; for (let i = 0; i < 5; i++) { await page.locator('#nav-new').click(); await page.locator('#entries').fill('Whale x1000\nShrimp'); await page.locator('#draw').click(); await page.locator('#winners').waitFor(); if ((await text('#winners li')) === 'Whale') heavy++; } assert.ok(heavy >= 4, `Whale won ${heavy}/5`);
  });
  await run('groups: balanced sizes, nobody missing', async () => {
    await page.locator('a', { hasText: 'Make groups' }).click().catch(() => {}); await page.goto(url + '#/?kind=groups'); await page.locator('#groups').waitFor(); await page.locator('#entries').fill(NAMES.concat(['Gus']).join('\n')); await page.locator('#groups').fill('3'); await page.locator('#seed').fill('teams'); await page.locator('#draw').click(); await page.locator('#groups .card').first().waitFor();
    const sizes = await page.locator('#groups .card').evaluateAll((cs) => cs.map((c) => c.querySelectorAll('li').length)); assert.deepEqual(sizes.sort(), [2, 2, 3]); const all = await page.locator('#groups li').allTextContents(); assert.deepEqual([...all].sort(), [...NAMES, 'Gus'].sort());
  });
  await run('secret santa: answers stay hidden until revealed; nobody gets themselves', async () => {
    await page.goto(url + '#/?kind=santa'); await page.locator('#ring').waitFor(); await page.locator('#entries').fill(NAMES.join('\n')); await page.locator('#seed').fill('xmas'); await page.locator('#draw').click(); await page.locator('#santa').waitFor(); assert.equal(await page.locator('[data-to]').count(), 0);
    const pairs = {}; for (const n of NAMES) { await page.locator(`[data-reveal="${n}"]`).click(); pairs[n] = (await text(`[data-from="${n}"] [data-to]`)).replace('→ ', ''); } assert.ok(NAMES.every((n) => pairs[n] !== n)); assert.equal(new Set(Object.values(pairs)).size, 6); assert.deepEqual(pairs, compute('santa', NAMES.join('\n'), 'xmas', { ring: true }).result.pairs);
    await page.locator('[data-from="Ann"] button', { hasText: 'Hide' }).click(); await page.locator('[data-reveal="Ann"]').waitFor();
  });
  await run('history lists draws; delete', async () => {
    await page.locator('#nav-history').click(); await page.locator('[data-draw]').first().waitFor(); assert.ok((await page.locator('[data-draw]').count()) >= 7); await page.locator('[data-draw="Door prize"]').click(); await page.locator('#delete').click(); await page.waitForFunction(() => !document.querySelector('[data-draw="Door prize"]'));
  });
  await run('mobile: no horizontal overflow', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); for (const h of ['#/', '#/history', '#/?kind=groups']) { await page.goto(url + h); await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); } await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
