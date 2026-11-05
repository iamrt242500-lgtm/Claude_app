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
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const create = async (title, body) => { await page.goto(url + '#/new'); await page.fill('#title', title); await page.fill('#body', body); await page.click('#save'); await page.getByRole('heading', { name: title, exact: true }).waitFor(); };
  const side = (t) => page.locator('#note-list a', { hasText: new RegExp('^' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });

  await run('welcome, validation errors', async () => {
    await page.goto(url); await page.getByText('Welcome to Linkpad').waitFor(); await page.getByText('No notes yet.').waitFor();
    await page.click('#new-note'); await page.click('#save'); await page.getByText('Title is required').waitFor();
    await page.fill('#title', 'bad [title]'); await page.click('#save'); await page.getByText('cannot contain').waitFor();
  });
  await run('markdown renders: headings, bold, lists, code, quote, safe links', async () => {
    await page.goto(url + '#/new'); await page.fill('#title', 'Markdown demo');
    await page.fill('#body', '# Big\n\nSome **bold** and *italic* and `inline`.\n\n- one\n- [x] done task\n\n> quote\n\n```js\nconst x = "<b>no html</b>";\n```\n\n[safe](https://example.com) [evil](javascript:alert(1)) <img src=x onerror=window.__x=1>');
    await page.locator('.preview strong', { hasText: 'bold' }).waitFor();   // live preview
    await page.click('#save'); await page.getByRole('heading', { name: 'Markdown demo' }).waitFor();
    await page.locator('.md strong', { hasText: 'bold' }).waitFor(); await page.locator('.md em', { hasText: 'italic' }).waitFor(); await page.locator('.md blockquote').waitFor();
    assert.equal(await page.locator('.md pre code').textContent(), 'const x = "<b>no html</b>";');
    assert.equal(await page.locator('.md a[href^="https://example.com"]').count(), 1); assert.equal(await page.locator('.md a[href^="javascript"]').count(), 0);
    assert.equal(await page.locator('.md img').count(), 0); assert.equal(await page.evaluate(() => window.__x), undefined);
    assert.equal(await page.locator('.md input[type=checkbox]:checked').count(), 1);
  });
  await run('wikilinks: ghost link, create from ghost, resolves + backlinks', async () => {
    await create('Hub', 'Go to [[Spoke]] and [[Spoke|the spoke]] and [[Nowhere]].');
    await page.locator('a.wiki.ghost', { hasText: 'Spoke' }).first().click(); await page.getByRole('heading', { name: 'New note' }).waitFor(); assert.equal(await page.inputValue('#title'), 'Spoke');
    await page.fill('#body', 'I am linked from [[hub]].'); await page.click('#save'); await page.getByRole('heading', { name: 'Spoke', exact: true }).waitFor();
    await page.locator('#backlinks a', { hasText: 'Hub' }).waitFor();                      // backlink
    await page.locator('.md a.wiki:not(.ghost)', { hasText: 'Hub' }).click(); await page.getByRole('heading', { name: 'Hub', exact: true }).waitFor();   // case-insensitive resolution
    assert.equal(await page.locator('.md a.wiki:not(.ghost)').count(), 2, 'both [[Spoke]] links now resolve'); assert.equal(await page.locator('.md a.wiki.ghost').count(), 1, '[[Nowhere]] still a ghost');
    await page.locator('#backlinks a', { hasText: 'Spoke' }).waitFor(); await page.screenshot({ path: 'e2e/shots/note.png' });
  });
  await run('rename rewrites links in other notes', async () => {
    await page.locator('#backlinks a', { hasText: 'Spoke' }).click(); await page.getByRole('heading', { name: 'Spoke', exact: true }).waitFor();
    await page.click('#edit'); await page.fill('#title', 'Satellite'); await page.click('#save'); await page.getByRole('heading', { name: 'Satellite', exact: true }).waitFor();
    await page.locator('#backlinks a', { hasText: 'Hub' }).click(); await page.getByRole('heading', { name: 'Hub', exact: true }).waitFor();
    await page.locator('.md a.wiki:not(.ghost)', { hasText: 'Satellite' }).waitFor(); await page.locator('.md a.wiki:not(.ghost)', { hasText: 'the spoke' }).waitFor();   // label preserved
  });
  await run('duplicate titles rejected (case-insensitive)', async () => {
    await page.goto(url + '#/new'); await page.fill('#title', 'hub'); await page.click('#save'); await page.getByText('already exists').waitFor();
  });
  await run('search with sidebar filtering; persistence after reload', async () => {
    await page.goto(url); await page.getByText(/\d+ notes?/).waitFor(); await page.fill('#search', 'satellite'); await page.getByText('found').waitFor();
    assert.ok(await side('Satellite').count() >= 1); await page.fill('#search', 'zzzzqq'); await page.getByText('No notes match.').waitFor(); await page.fill('#search', '"; DROP TABLE notes; --'); await page.getByText('No notes match.').waitFor();
    await page.fill('#search', ''); await page.getByText(/\d+ notes?$/).waitFor(); await page.reload(); await side('Hub').waitFor();
  });
  await run('delete note with confirmation; its links become ghosts', async () => {
    await side('Satellite').first().click(); await page.getByRole('heading', { name: 'Satellite', exact: true }).waitFor(); await page.click('#del'); await page.click('#confirm-del');
    await page.getByText('Welcome to Linkpad').waitFor(); await side('Hub').first().click(); await page.getByRole('heading', { name: 'Hub', exact: true }).waitFor(); assert.equal(await page.locator('.md a.wiki.ghost').count(), 3);
  });
  await run('server error, network failure, not found', async () => {
    await page.route('**/api/notes/*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/n/1'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/notes/*'); await page.getByRole('button', { name: 'Retry' }).click(); await page.locator('.md').first().waitFor();
    await page.goto(url + '#/n/9999'); await page.getByText('Note not found').waitFor();
  });
  await run('XSS in title shows as text', async () => {
    await create('<img src=x onerror=window.__y=1>', 'body'); assert.equal(await page.evaluate(() => window.__y), undefined); await side('<img').first().waitFor();
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    for (const hsh of ['#/', '#/new', '#/n/1']) {
      await mp.goto(url + hsh); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(300);
      const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => !e.closest('pre,textarea') && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`));
      assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow on ${hsh}: ${over.join(', ')}`);
    }
    await mp.goto(url + '#/n/1'); await mp.waitForTimeout(300); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
