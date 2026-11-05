import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { server } = createApp();
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.slice(0, -1) }).catch(() => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const add = async (title, lang, code, tags, notes = '') => {
    await page.goto(url + '#/new'); await page.fill('[name=title]', title); await page.fill('[name=language]', lang); await page.fill('[name=code]', code); await page.fill('[name=tags]', tags); if (notes) await page.fill('[name=notes]', notes);
    await page.click('#save'); await page.getByRole('heading', { name: title }).waitFor();
  };

  await run('empty library; form validation', async () => {
    await page.goto(url); await page.getByText('Your library is empty').waitFor();
    await page.click('#new-snippet'); await page.click('#save');
    await page.getByText('Title is required').waitFor(); await page.getByText('Code is required').waitFor();
    await page.fill('[name=title]', 'x'); await page.fill('[name=code]', 'y'); await page.fill('[name=language]', 'bad lang!'); await page.click('#save'); await page.getByText('Language must be').waitFor();
    assert.equal(await page.inputValue('[name=title]'), 'x', 'form keeps typed values after error');
  });
  await run('create snippets; view with code intact; persists', async () => {
    await add('Array flatten', 'js', 'const out = nested.flat(Infinity);\nconsole.log(out)', 'array, js', 'flattening nested arrays');
    await add('Debounce', 'ts', 'function debounce(fn: Function, ms: number) {\n  let t: any;\n  return (...a: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };\n}', 'util');
    await add('List comprehension', 'python', '[x * 2 for x in xs]', 'python, array');
    assert.equal(await page.locator('#code').textContent(), '[x * 2 for x in xs]');
    await page.reload(); await page.getByRole('heading', { name: 'List comprehension' }).waitFor();
  });
  await run('full-text search: ranking, highlight, prefix, stemming, no results, hostile input', async () => {
    await page.goto(url); await page.getByText('3 snippets').waitFor();
    await page.fill('#search', 'flat'); await page.getByText('(best match first)').waitFor();
    assert.equal(await page.locator('article h2').first().textContent(), 'Array flatten'); await page.locator('article mark').first().waitFor();
    await page.fill('#search', 'comprehens'); await page.getByText('1 snippet match').waitFor();
    await page.fill('#search', 'flattening'); await page.locator('article', { hasText: 'Array flatten' }).waitFor();
    await page.fill('#search', 'zzzzqq'); await page.getByText('No snippets match your search.').waitFor();
    await page.fill('#search', '"; DROP TABLE snippets; --'); await page.getByText('0 snippets match').waitFor();
    await page.fill('#search', '***'); await page.getByText('0 snippets match').waitFor();
    await page.fill('#search', ''); await page.getByText('3 snippets').waitFor();
    await page.fill('#search', 'debounce'); await page.getByText('1 snippet match').waitFor(); await page.screenshot({ path: 'e2e/shots/search.png' });
    await page.fill('#search', ''); await page.getByText('3 snippets').waitFor();
  });
  await run('tag and language filters, pinned', async () => {
    await page.getByRole('button', { name: /#array/ }).click(); await page.getByText('2 snippets match').waitFor();
    await page.getByRole('button', { name: /^python/ }).click(); await page.getByText('1 snippet match').waitFor();
    await page.getByRole('button', { name: /#array/ }).click(); await page.getByRole('button', { name: /^python/ }).click(); await page.getByText('3 snippets').waitFor();
    await page.getByRole('link', { name: 'Debounce' }).click(); await page.click('#pin'); await page.getByRole('button', { name: 'Unpin' }).waitFor();
    await page.goto(url + '#/'); await page.locator('article h2').first().getByText('★ Debounce').waitFor();
    await page.click('#pinned-filter'); await page.getByText('1 snippet match').waitFor(); await page.click('#pinned-filter'); await page.getByText('3 snippets').waitFor();
  });
  await run('copy to clipboard', async () => {
    await page.getByRole('link', { name: /Debounce/ }).click(); await page.click('#copy'); await page.getByText('Copied to clipboard').waitFor();
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null)); if (clip !== null) assert.ok(clip.startsWith('function debounce'));
  });
  await run('edit re-indexes search; delete removes it', async () => {
    await page.getByRole('link', { name: 'Edit' }).click(); await page.fill('[name=title]', 'Throttle'); await page.click('#save'); await page.getByRole('heading', { name: /Throttle/ }).waitFor();
    await page.goto(url + '#/'); await page.fill('#search', 'throttle'); await page.getByText('1 snippet match').waitFor(); await page.fill('#search', 'debounce'); await page.locator('article', { hasText: 'Throttle' }).waitFor(); // code still contains "debounce"
    await page.fill('#search', ''); await page.getByRole('link', { name: /Throttle/ }).click(); await page.click('#del'); await page.click('#confirm-del'); await page.getByText('2 snippets').waitFor();
  });
  await run('export then import round trip; invalid import reported', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]); const path = await dl.path(); assert.ok(path);
    const good = join(tmpdir(), 'snipbox-import.json'); writeFileSync(good, JSON.stringify({ snippets: [{ title: 'Imported one', code: 'echo hi', language: 'bash', tags: ['sh'] }, { title: '', code: 'bad' }] }));
    await page.setInputFiles('#import-file', good); await page.getByText('Imported 1, skipped 1 invalid').waitFor();
    await page.fill('#search', 'imported'); await page.getByText('1 snippet match').waitFor();
    const junk = join(tmpdir(), 'snipbox-junk.json'); writeFileSync(junk, 'not json'); await page.setInputFiles('#import-file', junk); await page.getByText('not valid JSON').waitFor();
  });
  await run('server error, network failure, not found', async () => {
    await page.route('**/api/tags', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/tags'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByRole('link', { name: /Library|Snipbox/ }).first().waitFor();
    await page.goto(url + '#/s/9999'); await page.getByText('Snippet not found').waitFor();
    await page.route('**/api/snippets?*', (r) => r.abort()); await page.goto(url + '#/'); await page.reload(); await page.getByText('Network error').waitFor(); await page.unroute('**/api/snippets?*'); await page.reload();
  });
  await run('XSS in title/code is inert', async () => {
    await add('<img src=x onerror=window.__x=1>', 'html', '<script>window.__x=2</script>', 'x');
    assert.equal(await page.locator('#code').textContent(), '<script>window.__x=2</script>'); assert.equal(await page.evaluate(() => window.__x), undefined);
  });
  await run('mobile: no horizontal page overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    for (const h of ['#/', '#/new', '#/s/1']) {
      await mp.goto(url + h); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(250);
      const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => !e.closest('pre') && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`));
      assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow on ${h}: ${over.join(', ')}`);
    }
    await mp.goto(url + '#/'); await mp.waitForTimeout(250); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
