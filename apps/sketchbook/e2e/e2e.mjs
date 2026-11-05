import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync, statSync } from 'node:fs';

const { server } = createApp();
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  // Logical canvas coordinates (0..800 x 0..600) -> page coordinates
  const box = async () => page.locator('#canvas').boundingBox();
  const at = async (x, y) => { const b = await box(); return [b.x + (x / 800) * b.width, b.y + (y / 600) * b.height]; };
  const drag = async (pts) => { const [x0, y0] = await at(...pts[0]); await page.mouse.move(x0, y0); await page.mouse.down(); for (const p of pts.slice(1)) { const [x, y] = await at(...p); await page.mouse.move(x, y, { steps: 6 }); } await page.mouse.up(); };
  const pixel = async (x, y) => page.evaluate(([x, y]) => { const c = document.querySelector('#canvas'), k = c.width / 800, d = c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data; return [d[0], d[1], d[2]]; }, [x, y]);
  const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const count = async () => (await page.locator('#count').textContent()).match(/\d+/)[0] * 1;

  await run('palette swatches are actually coloured', async () => {
    await page.goto(url + '#/new'); await page.locator('.sw').first().waitFor(); const cols = await page.locator('.sw').evaluateAll((l) => l.map((e) => getComputedStyle(e).backgroundColor)); assert.equal(new Set(cols).size, cols.length, 'every swatch has a distinct colour'); assert.equal(cols[0], 'rgb(17, 17, 17)'); assert.equal(cols[1], 'rgb(225, 29, 72)');
  });
  await run('empty gallery; blank canvas is white', async () => {
    await page.goto(url + '#/'); await page.getByText('No drawings yet').waitFor(); await page.click('#new-drawing'); await page.locator('#canvas').waitFor(); assert.deepEqual(await pixel(400, 300), [255, 255, 255]); assert.equal(await count(), 0); assert.ok(await page.locator('#undo').isDisabled());
  });
  await run('draw a stroke with the mouse: pixels change under the line, stroke count updates', async () => {
    await page.locator('.sw[data-color="#e11d48"]').click(); await page.fill('#size', '20'); await page.dispatchEvent('#size', 'input'); await drag([[100, 300], [300, 300], [500, 300]]);
    assert.equal(await count(), 1); assert.ok(near(await pixel(300, 300), [225, 29, 72]), 'red under the line'); assert.deepEqual(await pixel(300, 420), [255, 255, 255], 'white away from the line'); assert.equal(await page.locator('#undo').isDisabled(), false);
  });
  await run('colour and size choices apply; custom colour via the picker', async () => {
    await page.fill('#size', '30'); await page.dispatchEvent('#size', 'input'); await page.locator('#color').evaluate((e) => { e.value = '#0000ff'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await drag([[200, 100], [600, 100]]);
    assert.ok(near(await pixel(400, 100), [0, 0, 255]), 'blue stroke'); assert.ok(near(await pixel(400, 112), [0, 0, 255]), 'thick stroke covers ±12px'); assert.deepEqual(await pixel(400, 130), [255, 255, 255]); assert.equal(await count(), 2);
  });
  await run('eraser paints the background back over a stroke', async () => {
    await page.locator('[data-tool="eraser"]').click(); await page.fill('#size', '40'); await page.dispatchEvent('#size', 'input'); await drag([[250, 300], [350, 300]]);
    assert.deepEqual(await pixel(300, 300), [255, 255, 255], 'erased'); assert.ok(near(await pixel(150, 300), [225, 29, 72]), 'untouched part remains'); assert.equal(await count(), 3);
  });
  await run('undo / redo via buttons and keyboard shortcuts; new stroke clears redo', async () => {
    await page.click('#undo'); assert.equal(await count(), 2); assert.ok(near(await pixel(300, 300), [225, 29, 72]), 'erase undone → red is back');
    await page.click('#redo'); assert.equal(await count(), 3); assert.deepEqual(await pixel(300, 300), [255, 255, 255]);
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); assert.equal(await count(), 1); assert.deepEqual(await pixel(400, 100), [255, 255, 255], 'blue undone'); await page.keyboard.press('Control+Shift+Z'); assert.equal(await count(), 2); assert.ok(near(await pixel(400, 100), [0, 0, 255]));
    await page.locator('[data-tool="pen"]').click(); await drag([[100, 500], [200, 500]]); assert.ok(await page.locator('#redo').isDisabled(), 'drawing after undo drops the redo history');
  });
  await run('single click makes a dot', async () => {
    await page.locator('.sw[data-color="#16a34a"]').click(); await page.fill('#size', '24'); await page.dispatchEvent('#size', 'input'); const [x, y] = await at(700, 500); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
    assert.ok(near(await pixel(700, 500), [22, 163, 74]), 'green dot'); assert.deepEqual(await pixel(700, 530), [255, 255, 255]);
  });
  await run('autosave creates the drawing; title edit; reload restores strokes exactly', async () => {
    await page.fill('#title', 'Test sketch'); await page.dispatchEvent('#title', 'change'); await page.getByText('Saved', { exact: true }).waitFor({ timeout: 8000 }); await page.waitForURL(/#\/d\/\d+$/);
    const n = await count(); await page.reload(); await page.locator('#canvas').waitFor(); assert.equal(await count(), n); assert.equal(await page.inputValue('#title'), 'Test sketch'); assert.ok(near(await pixel(150, 300), [225, 29, 72])); assert.ok(near(await pixel(700, 500), [22, 163, 74])); assert.ok(near(await pixel(300, 300), [225, 29, 72]), 'the discarded eraser stroke (dropped from redo history by the later stroke) is not part of the saved drawing');
    await page.screenshot({ path: 'e2e/shots/editor.png' });
  });
  await run('clear (confirm) is undoable', async () => {
    const before = await count(); await page.click('#clear'); await page.click('#confirm-ok'); assert.equal(await count(), 0); assert.deepEqual(await pixel(150, 300), [255, 255, 255]); await page.click('#undo'); assert.equal(await count(), before, 'ONE undo restores everything that Clear removed'); assert.ok(near(await pixel(150, 300), [225, 29, 72]));
    await page.click('#redo'); assert.equal(await count(), 0, 'redo re-applies the clear'); await page.click('#undo');
    assert.equal(await count(), before, 'drawing is fully restored for the export step');
  });
  await run('export PNG (real image, white background) and SVG', async () => {
    const [png] = await Promise.all([page.waitForEvent('download'), page.click('#export-png')]); const f = await png.path(); assert.equal(png.suggestedFilename(), 'Test_sketch.png'); assert.ok(statSync(f).size > 1500, 'non-trivial PNG');
    const [svg] = await Promise.all([page.waitForEvent('download'), page.click('#export-svg')]); const text = await (await import('node:fs/promises')).readFile(await svg.path(), 'utf8'); assert.equal(svg.suggestedFilename(), 'Test_sketch.svg'); assert.match(text, /^<svg /); assert.match(text, /<path d="M/); assert.match(text, /stroke="#e11d48"/);
  });
  await run('gallery shows a rendered thumbnail, stroke count; open and delete', async () => {
    await page.goto(url + '#/'); const card = page.locator('[data-title="Test sketch"]'); await card.waitFor(); const img = card.locator('img'); await img.waitFor(); await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    await card.getByRole('link', { name: 'Open Test sketch' }).click(); await page.locator('#canvas').waitFor(); await page.goto(url + '#/');
    await page.getByRole('button', { name: 'Delete Test sketch' }).click(); await page.click('#confirm-ok'); await page.getByText('No drawings yet').waitFor();
  });
  await run('leaving the editor saves pending changes first (gallery is never stale)', async () => {
    await page.goto(url + '#/new'); await page.locator('#canvas').waitFor(); await drag([[100, 100], [400, 200]]); await page.click('a:has-text("Gallery")'); await page.locator('[data-title="Untitled drawing"]').getByText('1 stroke').waitFor();
  });
  await run('server error, network failure on save, not found', async () => {
    await page.goto(url + '#/new'); await page.locator('#canvas').waitFor(); await page.route('**/api/drawings', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue())); await drag([[100, 100], [300, 300]]); await page.click('#save'); await page.getByText('Network error').waitFor(); await page.unroute('**/api/drawings');
    await page.goto(url + '#/d/9999'); await page.getByText('Drawing not found').waitFor();
  });
  await run('mobile: touch-sized canvas fits the screen, no horizontal overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 }, hasTouch: true })).newPage(); await mp.goto(url + '#/new'); await mp.locator('#canvas').waitFor(); await mp.waitForTimeout(300);
    const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`)); assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow: ${over.join(', ')}`);
    assert.equal(await mp.locator('#canvas').evaluate((e) => getComputedStyle(e).touchAction), 'none'); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
