import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp(); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  const text = (s) => page.locator(s).textContent();
  await run('hint until two fields are filled; then the third is calculated', async () => {
    await page.goto(url); await page.locator('#hint').waitFor(); await page.locator('#distance').fill('10k'); await page.locator('#time').fill('50:00');
    await page.locator('#pace-line').waitFor(); assert.match(await text('#pace-line'), /Pace 5:00 \/km · 12 km\/h/); assert.match(await text('#summary'), /50:00 for 10 km/); assert.equal(await page.locator('#splits tbody tr').count(), 10);
  });
  await run('solve distance from time+pace; switching units updates pace', async () => {
    await page.locator('#distance').fill(''); await page.locator('#pace').fill('5:00'); await page.waitForFunction(() => /for 10 km/.test(document.getElementById('summary')?.textContent || ''));
    await page.locator('#pace').fill(''); await page.locator('#distance').fill('10k'); await page.locator('#unit').selectOption('mi'); await page.waitForFunction(() => /8:03 \/mi/.test(document.getElementById('pace-line')?.textContent || '')); assert.equal(await page.locator('#splits tbody tr').count(), 7);
  });
  await run('predictions table; error message for nonsense; three filled fields rejected', async () => {
    await page.locator('#unit').selectOption('km'); await page.locator('[data-race="Marathon"]').waitFor(); assert.match(await text('[data-race="Marathon"]'), /3:50:01/); assert.match(await text('[data-race="10K"]'), /50:00/);
    await page.locator('#time').fill('1:75'); await page.locator('#calc-error').getByText('Time not understood').waitFor(); await page.locator('#time').fill('50:00'); await page.locator('#pace').fill('5:00'); await page.locator('#calc-error').getByText('Leave one').waitFor();
  });
  await run('negative split: first split slower than last, total unchanged; URL restores the inputs', async () => {
    await page.locator('#pace').fill(''); await page.locator('#negative').fill('4'); await page.waitForFunction(() => { const r = [...document.querySelectorAll('#splits tbody tr')]; return r.length === 10 && r[0].children[3].textContent !== r[9].children[3].textContent; });
    const rows = await page.locator('#splits tbody tr').evaluateAll((rs) => rs.map((r) => r.children[3].textContent)); const sec = (x) => x.split(':').reduce((a, b) => a * 60 + Number(b), 0); assert.ok(sec(rows[0]) > sec(rows[9])); assert.equal(await page.locator('#splits tbody tr:last-child td:last-child').textContent(), '50:00');
    const u = page.url(); await page.goto('about:blank'); await page.goto(u); await page.locator('#pace-line').waitFor(); assert.equal(await page.locator('#distance').inputValue(), '10k'); assert.equal(await page.locator('#negative').inputValue(), '4');
  });
  await run('save as goal prefills the goals form; goal list; validation; delete', async () => {
    await page.locator('#save-goal').click(); assert.equal(await page.locator('#gdist').inputValue(), '10k'); assert.equal(await page.locator('#gtime').inputValue(), '50:00');
    await page.getByRole('button', { name: 'Save goal' }).click(); await page.locator('#form-error').getByText('Name is required').waitFor();
    await page.locator('#gname').fill('Autumn 10K'); await page.locator('#gdate').fill('2026-10-04'); await page.getByRole('button', { name: 'Save goal' }).click(); await page.locator('[data-goal]').waitFor(); assert.match(await text('[data-goal]'), /5:00\/km · 8:03\/mi/);
    await page.getByRole('link', { name: 'Open in calculator' }).click(); await page.locator('#pace-line').waitFor(); assert.match(await text('#pace-line'), /Pace 5:00/);
    await page.locator('#nav-goals').click(); await page.locator('[data-goal] button').click(); await page.getByText('No goals yet').waitFor();
  });
  await run('mobile: no horizontal overflow (full marathon split table scrolls inside its wrapper)', async () => {
    await page.setViewportSize({ width: 360, height: 700 }); await page.goto(url + '#/?distance=marathon&time=3:30:00&unit=km'); await page.locator('#splits').waitFor(); await page.waitForFunction(() => document.querySelectorAll('#splits tbody tr').length === 43);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
