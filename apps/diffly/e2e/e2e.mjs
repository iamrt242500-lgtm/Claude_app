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
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.slice(0, -1) }).catch(() => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  // Playwright's fill() takes ~15 s for a 3000-line textarea (even on a bare <textarea>), so large inputs are set directly + an input event, like a paste would.
  const setValue = (id, v) => page.evaluate(([id, v]) => { const el = document.querySelector(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
  const setBoth = async (l, r) => { await page.fill('#left', l); await page.fill('#right', r); };
  const waitStats = async (re) => { await page.waitForFunction(([src, flags]) => new RegExp(src, flags).test((document.querySelector('#stats')?.textContent || '').replace(/\s+/g, ' ')), [re.source, re.flags], { timeout: 5000 }); };
  const stats = async () => (await page.locator('#stats').textContent()).replace(/\s+/g, ' ');

  await run('empty state prompts for input', async () => { await page.goto(url); await page.getByText('Paste text on both sides').waitFor(); });
  await run('side-by-side diff with line numbers, +/- stats and word-level highlights', async () => {
    await page.fill('#left', 'a\nb\nc'); await page.getByText('3 lines').first().waitFor(); await page.fill('#left', 'one'); await page.locator('#left-count').getByText('1 line', { exact: true }).waitFor();
    await setBoth('the quick brown fox\njumps over\nthe lazy dog\nend', 'the quick red fox\njumps over\nthe lazy dog\nnew line\nend');
    await waitStats(/\+2.*−1.*1 changed.*3 unchanged/);
    assert.deepEqual(await page.locator('mark.w-del').allTextContents(), ['brown']); assert.deepEqual(await page.locator('mark.w-add').allTextContents(), ['red']);
    assert.equal(await page.locator('tr.add').count(), 1); assert.equal(await page.locator('tr.mod').count(), 1); assert.equal(await page.locator('tr.del').count(), 0);
    await page.screenshot({ path: 'e2e/shots/side.png' });
  });
  await run('unified view and copy patch', async () => {
    await page.click('#view-unified'); await page.locator('table.d[aria-label="Unified diff"]').waitFor(); assert.equal(await page.locator('tr.del').count(), 1); assert.equal(await page.locator('tr.add').count(), 2);
    await page.click('#copy-patch'); await page.getByText('Unified diff copied').waitFor(); const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null)); if (clip !== null) { assert.match(clip, /^--- left\n\+\+\+ right\n@@ -1,4 \+1,5 @@\n-the quick brown fox\n\+the quick red fox\n jumps over\n the lazy dog\n\+new line\n end\n$/); }
  });
  await run('options: ignore whitespace and case turn differences into "identical"', async () => {
    await page.click('#view-side'); await setBoth('Hello   World\n  indented', 'hello world\nindented'); await waitStats(/\+2/);
    await page.click('#opt-ws'); await page.locator('table.side').waitFor(); await page.click('#opt-case'); await page.locator('#identical').waitFor(); await page.getByText('(with the selected options)').waitFor();
    await page.click('#opt-ws'); await page.click('#opt-case'); await page.locator('table.side').waitFor();
  });
  await run('swap sides flips additions and deletions; identical texts', async () => {
    await setBoth('a\nb', 'a\nb\nc'); await waitStats(/\+1.*−0/); await page.click('#swap'); assert.equal(await page.inputValue('#left'), 'a\nb\nc'); await page.waitForFunction(() => /−1/.test(document.querySelector('#stats')?.textContent || ''));
    await setBoth('same', 'same'); await page.locator('#identical').waitFor();
  });
  await run('"only changes" collapses long unchanged runs', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => 'line ' + i); const changed = lines.slice(); changed[30] = 'CHANGED'; await setBoth(lines.join('\n'), changed.join('\n')); await page.locator('table.side').waitFor();
    const all = await page.locator('table.side tr').count(); await page.click('#opt-changes'); await page.locator('table.side').waitFor(); const few = await page.locator('table.side tr').count(); assert.ok(all === 60 && few < 20, `collapsed from ${all} to ${few}`); await page.getByText(/unchanged lines?/).first().waitFor();
    await page.click('#opt-changes');
  });
  await run('CRLF vs LF and trailing newline are not differences; typing updates the diff live', async () => {
    await setBoth('a\r\nb\r\n', 'a\nb'); await page.locator('#identical').waitFor(); await page.fill('#right', 'a\nb\nc'); await waitStats(/\+1/);
  });
  await run('large input is handled quickly; over-limit input shows a clear error', async () => {
    const big = Array.from({ length: 3000 }, (_, i) => 'row ' + i); const b2 = big.slice(); for (let i = 0; i < 3000; i += 100) b2[i] = 'edited ' + i; const t = Date.now(); await setValue('#left', big.join('\n')); await setValue('#right', b2.join('\n')); await waitStats(/\+30.*−30.*30 changed.*2,?970 unchanged/); assert.equal(await page.locator('table.side tr').count(), 3000); assert.ok(Date.now() - t < 3000, `diff + render of 3000 lines took ${Date.now() - t} ms`);
    await setValue('#left', 'x\n'.repeat(8001)); await page.getByRole('alert').getByText('≤ 8000 lines').waitFor(); await page.fill('#left', 'ok'); await page.fill('#right', 'ok2'); await page.locator('table.side').waitFor();
  });
  await run('save a comparison; list shows stats; reload and load it back; duplicate titles allowed; delete', async () => {
    await setBoth('port=80\nhost=a', 'port=8080\nhost=a\ndebug=1'); await page.click('#save'); await page.getByText('Title is required').waitFor();
    await page.fill('#save-title', 'Config change'); await page.click('#save'); await page.locator('[data-saved="Config change"]').getByText('+2 −1').waitFor();
    await page.reload(); await page.locator('[data-saved="Config change"]').waitFor(); await page.getByRole('button', { name: 'Load Config change' }).click(); await page.getByText('Loaded Config change').waitFor(); assert.equal(await page.inputValue('#left'), 'port=80\nhost=a'); await page.locator('table.side').waitFor();
    await page.getByRole('button', { name: 'Delete Config change' }).click(); await page.locator('[data-saved="Config change"]').waitFor({ state: 'detached' });
  });
  await run('server error and network failure when saving', async () => {
    await page.fill('#save-title', 'X'); await page.route('**/api/comparisons', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }) : r.continue())); await page.click('#save'); await page.getByText('Internal server error').waitFor();
    await page.unroute('**/api/comparisons'); await page.route('**/api/comparisons', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue())); await page.click('#save'); await page.getByText('Network error').waitFor(); await page.unroute('**/api/comparisons');
  });
  await run('HTML in the text is shown literally (XSS)', async () => {
    await setBoth('<img src=x onerror=window.__x=1>', '<img src=x onerror=window.__x=2>'); await page.locator('table.side').waitFor(); assert.equal(await page.evaluate(() => window.__x), undefined); assert.equal(await page.locator('#diff img').count(), 0);
  });
  await run('mobile: no horizontal overflow outside the diff area', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage(); await mp.goto(url); await mp.fill('#left', 'a\nsome rather long line that needs wrapping on a phone screen\nc'); await mp.fill('#right', 'a\nsome rather long line that needs wrapping on a phone screen!\nd'); await mp.locator('table.side').waitFor(); await mp.waitForTimeout(250);
    const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => !e.closest('.diff') && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`)); assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow: ${over.join(', ')}`); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
