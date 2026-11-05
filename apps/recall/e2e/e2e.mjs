import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp();
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init';
const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await run('empty state + deck validation', async () => {
    await page.goto(url); await page.getByText('No decks yet').waitFor();
    await page.click('#add-deck'); await page.getByText('name is required').waitFor();
  });
  await run('create deck, add single card, bulk import with error then success', async () => {
    await page.fill('#deck-name', 'Spanish'); await page.click('#add-deck');
    await page.getByRole('heading', { name: 'Spanish' }).waitFor();
    await page.fill('[name=front]', 'hola'); await page.fill('[name=back]', 'hello'); await page.click('#add-card');
    await page.getByText('Cards (1)').waitFor();
    await page.click('#to-bulk');
    await page.fill('[name=bulk]', 'gato :: cat\nbroken line'); await page.click('#import');
    await page.getByText('Lines without').waitFor();
    await page.fill('[name=bulk]', 'gato :: cat\nperro :: dog'); await page.click('#import');
    await page.getByText('Cards (3)').waitFor();
  });
  await run('edit and delete a card', async () => {
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.locator('li form').getByLabel('Back').fill('hi'); await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('hi', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Delete' }).last().click();
    await page.getByText('Cards (2)').waitFor();
  });
  await run('study session with keyboard, persists across reload', async () => {
    await page.getByRole('link', { name: /Study/ }).click();
    await page.getByText('1 / 2').waitFor();
    await page.keyboard.press('Space'); await page.locator('#flash').getByText(/.+/).waitFor();
    await page.screenshot({ path: 'e2e/shots/study.png' });
    await page.keyboard.press('3'); await page.getByText('2 / 2').waitFor();
    await page.keyboard.press('Space'); await page.keyboard.press('1');
    await page.getByText('Session complete').waitFor();
    await page.goto(url); await page.reload();
    await page.getByText('0 due').waitFor();   // Good -> due tomorrow; Again -> due tomorrow too
  });
  await run('stats reflect reviews', async () => {
    await page.goto(url + '#/stats');
    await page.locator('.stat', { hasText: 'Reviewed today' }).getByText('2', { exact: true }).waitFor();
    await page.locator('.stat', { hasText: 'Retention' }).getByText('50%').waitFor();
    await page.locator('svg.chart').waitFor();
    await page.screenshot({ path: 'e2e/shots/stats.png' });
  });
  await run('nothing due message', async () => {
    await page.goto(url); await page.reload();
    assert.ok(await page.getByRole('button', { name: 'Study' }).isDisabled());
    await page.goto(url + '#/study/1'); await page.getByText('Nothing due').waitFor();
  });
  await run('server error + network failure + not found', async () => {
    await page.route('**/api/decks', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/decks'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByRole('heading', { name: 'Your decks' }).waitFor();
    await page.route('**/api/stats', (r) => r.abort()); await page.goto(url + '#/stats'); await page.getByText('Network error').waitFor(); await page.unroute('**/api/stats');
    await page.goto(url + '#/deck/999'); await page.getByText('Deck not found').waitFor();
  });
  await run('XSS in card text rendered inertly', async () => {
    await page.goto(url + '#/'); await page.getByRole('link', { name: 'Spanish' }).click();
    await page.fill('[name=front]', '<img src=x onerror=window.__x=1>'); await page.fill('[name=back]', 'b'); await page.click('#add-card');
    await page.getByText('Cards (3)').waitFor();
    assert.equal(await page.evaluate(() => window.__x), undefined);
  });
  await run('delete deck with confirmation', async () => {
    await page.click('#del-deck'); await page.click('#confirm-del');
    await page.getByText('No decks yet').waitFor();
  });
  await run('mobile no overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    await mp.goto(url); await mp.fill('#deck-name', 'M'); await mp.click('#add-deck'); await mp.getByRole('heading', { name: 'M' }).waitFor();
    await mp.fill('[name=front]', 'q'); await mp.fill('[name=back]', 'a'); await mp.click('#add-card'); await mp.getByText('Cards (1)').waitFor();
    for (const h of ['#/', '#/stats', '#/deck/2']) { await mp.goto(url + h); await mp.waitForTimeout(150); assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow ' + h); }
    await mp.goto(url + '#/study/2'); await mp.waitForTimeout(150); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
