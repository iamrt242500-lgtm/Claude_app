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
  await run('default pair #767676 on white is the 4.54 AA boundary; preview is actually coloured', async () => {
    await page.goto(url); await page.locator('#ratio').waitFor(); assert.equal(await text('#ratio'), '4.54:1'); assert.equal(await text('#level'), 'AA'); assert.match(await text('[data-badge="AA normal"]'), /Pass/); assert.match(await text('[data-badge="AAA normal"]'), /Fail/);
    assert.equal(await page.locator('#sample').evaluate((e) => getComputedStyle(e).color), 'rgb(118, 118, 118)'); assert.equal(await page.locator('#sample').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)');
  });
  await run('typing updates live; failing pair offers a suggestion that applies and passes', async () => {
    await page.locator('#fg').fill('#777'); assert.equal(await text('#ratio'), '4.47:1'); assert.match(await text('[data-badge="AA normal"]'), /Fail/); assert.match(await text('[data-suggest="Nearest AA"]'), /#767676/);
    await page.locator('[data-suggest="Nearest AA"] button').click(); assert.equal(await page.locator('#fg').inputValue(), '#767676'); assert.equal(await text('#ratio'), '4.54:1');
    await page.locator('[data-suggest="Nearest AAA"] button').click(); assert.ok(Number((await text('#ratio')).replace(':1', '')) >= 7); assert.equal(await page.locator('[data-suggest]').count(), 0, 'nothing left to suggest');
  });
  await run('invalid input shows a message (no crash); swap works; URL is shareable', async () => {
    await page.locator('#fg').fill('banana'); await page.locator('#bad-input').waitFor(); assert.equal(await page.locator('#fg').getAttribute('aria-invalid'), 'true');
    await page.locator('#fg').fill('rgb(0 0 0)'); await page.locator('#bg').fill('hsl(0 0% 100%)'); assert.equal(await text('#ratio'), '21:1'); await page.locator('#swap').click(); assert.equal(await page.locator('#fg').inputValue(), 'hsl(0 0% 100%)'); assert.equal(await text('#ratio'), '21:1');
    await page.locator('#fg').fill('#ffcc00'); await page.locator('#bg').fill('#ffffff'); const u = page.url(); await page.goto('about:blank'); await page.goto(u); await page.locator('#ratio').waitFor(); assert.equal(await page.locator('#fg').inputValue(), '#ffcc00');
  });
  await run('palette: save with rgb() commas, matrix shows pairs and below-AA summary', async () => {
    await page.locator('#nav-pal').click(); await page.locator('#pname').fill('Brand'); await page.locator('#pcolors').fill('#000000, rgb(255, 255, 255), #777777'); await page.getByRole('button', { name: 'Save' }).click();
    await page.locator('#summary').waitFor(); assert.match(await text('#summary'), /2 of 6/); assert.equal((await text('[data-pair="#000000/#ffffff"]')).replace(/\s/g, ''), '21:1AAA'); assert.match(await text('[data-pair="#777777/#ffffff"]'), /AA Large/);
  });
  await run('palette validation error; delete', async () => {
    await page.locator('#nav-pal').click(); await page.locator('#pname').fill('Bad'); await page.locator('#pcolors').fill('#fff, nope'); await page.getByRole('button', { name: 'Save' }).click(); await page.locator('#form-error').getByText('not recognised').waitFor();
    await page.locator('[data-palette]').click(); await page.locator('#delete').click(); await page.getByText('No palettes yet').waitFor();
  });
  await run('mobile: no horizontal overflow', async () => {
    await page.setViewportSize({ width: 360, height: 700 });
    await page.goto(url + '#/palettes'); await page.locator('#pname').fill('Wide'); await page.locator('#pcolors').fill('#111111, #222222, #333333, #444444, #555555, #666666'); await page.getByRole('button', { name: 'Save' }).click(); await page.locator('#summary').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflows (the matrix must scroll inside its wrapper)'); await page.goto(url); await page.locator('#ratio').waitFor(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
