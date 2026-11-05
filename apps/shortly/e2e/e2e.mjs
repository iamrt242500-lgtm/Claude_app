import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp();
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
// A separate "destination" site so redirects can be followed for real (no internet needed).
let lastReferer = null;
const dest = createServer((req, res) => { lastReferer = req.headers.referer ?? null; res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<title>Destination</title><h1 id="landed">Landed on ${req.url}</h1>`); });
await new Promise((r) => dest.listen(0, r));
const D = `http://127.0.0.1:${dest.address().port}`;
mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' });   // a normal UA: HeadlessChrome is (intentionally) classified as a bot
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const item = (code) => page.locator(`[data-code="${code}"]`);

  await run('empty state; all validation errors shown together', async () => {
    await page.goto(url); await page.getByText('No links yet').waitFor();
    await page.fill('#url', 'javascript:alert(1)'); await page.fill('#slug', 'api'); await page.click('#create');
    await page.getByText('Only http and https links are allowed').waitFor(); await page.getByText('That slug is reserved').waitFor();
    await page.fill('#url', url + 's/abc'); await page.fill('#slug', ''); await page.click('#create'); await page.getByText('Links to this service itself are not allowed').waitFor();
    await page.fill('#url', 'https://user:pw@example.com'); await page.click('#create'); await page.getByText('embedded credentials').waitFor();
  });
  await run('create link with custom slug; persists; slug uniqueness', async () => {
    await page.fill('#url', D + '/landing?x=1'); await page.fill('#slug', 'My-Link'); await page.fill('#title', 'Landing page'); await page.click('#create');
    await item('My-Link').waitFor(); await item('My-Link').getByText('0 clicks').waitFor(); await item('My-Link').getByText('Landing page').waitFor();
    await page.reload(); await item('My-Link').waitFor();
    await page.fill('#url', D + '/other'); await page.fill('#slug', 'my-link'); await page.click('#create'); await page.getByText('That slug is already taken').waitFor();
  });
  await run('random code created for a bare host; no slug', async () => {
    await page.fill('#slug', ''); await page.fill('#url', 'example.com/docs'); await page.click('#create');
    await page.locator('[data-code]').nth(1).waitFor(); const code = await page.locator('[data-code]').first().getAttribute('data-code'); assert.match(code, /^[A-Za-z0-9]{6}$/);
    await item(code).getByText('https://example.com/docs').waitFor();
  });
  await run('following the short link really redirects, and clicks are counted', async () => {
    const p2 = await ctx.newPage(); await p2.goto(url + 's/my-link'); await p2.locator('#landed').waitFor();
    assert.equal(await p2.locator('#landed').textContent(), 'Landed on /landing?x=1'); await p2.goto(url + 's/MY-LINK'); await p2.locator('#landed').waitFor(); await p2.close();
    await page.goto(url + '#/'); await page.reload(); await item('My-Link').getByText('2 clicks').waitFor();
  });
  await run('unknown link gives a friendly 404 page', async () => {
    const p2 = await ctx.newPage(); const r = await p2.goto(url + 's/doesnotexist'); assert.equal(r.status(), 404); await p2.getByText('does not exist').waitFor(); await p2.close();
  });
  await run('stats page: totals, chart, referrers, devices, bots separated', async () => {
    await fetch(url + 's/My-Link', { redirect: 'manual', headers: { 'user-agent': 'Googlebot/2.1' } }); await fetch(url + 's/My-Link', { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', referer: 'https://www.news.example/story' } });
    await page.goto(url + '#/'); await page.reload(); await item('My-Link').getByRole('link', { name: 'Stats' }).click();
    await page.getByRole('heading', { name: 'Landing page' }).waitFor();
    assert.equal(await page.locator('.stat', { hasText: 'Human clicks' }).locator('b').textContent(), '3'); assert.equal(await page.locator('.stat', { hasText: 'Bot / preview' }).locator('b').textContent(), '1');
    await page.getByRole('cell', { name: 'news.example' }).waitFor(); await page.getByRole('cell', { name: '(direct)' }).waitFor(); await page.getByRole('cell', { name: 'mobile' }).waitFor();
    assert.equal(await page.locator('svg[aria-label^="Clicks per day"] rect').count(), 30); await page.screenshot({ path: 'e2e/shots/stats.png' });
  });
  await run('disable and re-enable: disabled links return 410', async () => {
    await page.goto(url + '#/'); await page.reload(); await page.getByRole('button', { name: 'Disable My-Link' }).click(); await item('My-Link').getByText('disabled', { exact: true }).waitFor();
    const p2 = await ctx.newPage(); const r = await p2.goto(url + 's/My-Link'); assert.equal(r.status(), 410); await p2.getByText('turned this link off').waitFor();
    await page.getByRole('button', { name: 'Enable My-Link' }).click(); await item('My-Link').getByText('active').waitFor(); await p2.goto(url + 's/My-Link'); await p2.locator('#landed').waitFor(); await p2.close();
  });
  await run('delete with confirmation; link stops working', async () => {
    await page.getByRole('button', { name: 'Delete My-Link' }).click(); await page.click('#confirm-del'); await item('My-Link').waitFor({ state: 'detached' });
    const p2 = await ctx.newPage(); assert.equal((await p2.goto(url + 's/My-Link')).status(), 404); await p2.close();
  });
  await run('server error, network failure, not found', async () => {
    await page.route('**/api/links', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/links'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByRole('heading', { name: 'Shorten a link' }).waitFor();
    await page.goto(url + '#/l/9999'); await page.getByText('Link not found').waitFor();
  });
  await run('XSS in title and URL is inert', async () => {
    await page.goto(url + '#/'); await page.fill('#url', D + '/x?q=<img src=x onerror=window.__x=1>'); await page.fill('#title', '<img src=x onerror=window.__y=1>'); await page.click('#create');
    await page.getByText('<img src=x onerror=window.__y=1>').first().waitFor(); assert.equal(await page.evaluate(() => [window.__x, window.__y]).then((a) => a.every((v) => v === undefined)), true);
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    for (const hsh of ['#/', '#/l/1']) {
      await mp.goto(url + hsh); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(300);
      const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`));
      assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow on ${hsh}: ${over.join(', ')}`);
    }
    await mp.goto(url + '#/'); await mp.waitForTimeout(300); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); dest.close(); }
