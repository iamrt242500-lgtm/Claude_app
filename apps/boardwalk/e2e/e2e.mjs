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
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const col = (name) => page.locator('section.col', { has: page.getByRole('heading', { name, exact: false }) }).first();
  const titles = async (name) => (await col(name).locator('.kcard .title').allTextContents());
  const addCard = async (colName, t) => { await col(colName).getByLabel('Add card to ' + colName).fill(t); await page.keyboard.press('Enter'); await col(colName).locator('.kcard', { hasText: t }).waitFor(); };

  await run('empty state + validation; create board with 3 default columns', async () => {
    await page.goto(url); await page.getByText('No boards yet').waitFor();
    await page.click('#create-board'); await page.getByText('Name is required').waitFor();
    await page.fill('#board-name', 'Launch plan'); await page.click('#create-board');
    await page.getByRole('heading', { name: 'Launch plan' }).waitFor();
    for (const n of ['To do', 'Doing', 'Done']) await page.getByRole('heading', { name: n }).waitFor();
  });
  await run('add cards (inline), order preserved, persists after reload', async () => {
    await addCard('To do', 'Write spec'); await addCard('To do', 'Build API'); await addCard('To do', 'Ship it');
    assert.deepEqual(await titles('To do'), ['Write spec', 'Build API', 'Ship it']);
    await page.reload(); await page.getByRole('heading', { name: 'To do' }).waitFor(); assert.deepEqual(await titles('To do'), ['Write spec', 'Build API', 'Ship it']);
  });
  await run('drag & drop across columns and within a column', async () => {
    await col('To do').locator('.kcard', { hasText: 'Write spec' }).dragTo(col('Doing').locator('.cards'));
    await col('Doing').locator('.kcard', { hasText: 'Write spec' }).waitFor();
    assert.deepEqual(await titles('To do'), ['Build API', 'Ship it']);
    await col('To do').locator('.kcard', { hasText: 'Ship it' }).dragTo(col('To do').locator('.kcard', { hasText: 'Build API' }), { targetPosition: { x: 20, y: 3 } });
    await page.waitForFunction(() => document.querySelector('section.col .kcard .title')?.textContent === 'Ship it');
    assert.deepEqual(await titles('To do'), ['Ship it', 'Build API']);
    await page.reload(); await page.getByRole('heading', { name: 'To do' }).waitFor();
    assert.deepEqual(await titles('To do'), ['Ship it', 'Build API']); assert.deepEqual(await titles('Doing'), ['Write spec']);
    await page.screenshot({ path: 'e2e/shots/board.png' });
  });
  await run('card dialog: edit fields, labels, overdue due date, validation', async () => {
    await col('Doing').locator('.kcard').click();
    await page.fill('dialog [name=title]', ''); await page.click('#save-card'); await page.getByText('Title is required').waitFor();
    await page.fill('dialog [name=title]', 'Write the spec'); await page.fill('dialog [name=due]', '2020-01-01'); await page.fill('dialog [name=labels]', 'Docs, Urgent'); await page.click('#save-card');
    const card = col('Doing').locator('.kcard', { hasText: 'Write the spec' }); await card.getByText('Overdue · 2020-01-01').waitFor(); await card.getByText('urgent').waitFor();
  });
  await run('keyboard/dialog move: Move right and column select', async () => {
    await col('Doing').locator('.kcard').click(); await page.click('#move-right'); await col('Done').locator('.kcard', { hasText: 'Write the spec' }).waitFor();
    await col('Done').getByText('Overdue').count().then((n) => assert.equal(n, 0, 'cards in last column are never flagged overdue'));
    await col('Done').locator('.kcard').click(); await page.selectOption('dialog [name=columnId]', { label: 'To do' }); await page.click('#save-card');
    await col('To do').locator('.kcard', { hasText: 'Write the spec' }).waitFor();
  });
  await run('filter cards', async () => {
    await page.fill('#filter', 'urgent'); assert.equal(await page.locator('.kcard').count(), 1);
    await page.fill('#filter', 'zzz'); assert.equal(await page.locator('.kcard').count(), 0); await page.fill('#filter', ''); assert.equal(await page.locator('.kcard').count(), 3);
  });
  await run('columns: add, rename, delete with cascade confirmation', async () => {
    await page.click('#add-column'); await page.fill('dialog [name=name]', 'Review'); await page.keyboard.press('Enter'); await page.getByRole('heading', { name: 'Review' }).waitFor();
    await page.getByRole('button', { name: 'Rename column Review' }).click(); await page.fill('dialog [name=name]', 'QA'); await page.keyboard.press('Enter'); await page.getByRole('heading', { name: 'QA' }).waitFor();
    await page.getByRole('button', { name: 'Delete column QA' }).click(); await page.click('#confirm-ok'); await page.getByRole('heading', { name: 'QA' }).waitFor({ state: 'detached' });
  });
  await run('delete a card from dialog', async () => {
    await col('To do').locator('.kcard', { hasText: 'Build API' }).click(); await page.click('#delete-card'); await col('To do').locator('.kcard', { hasText: 'Build API' }).waitFor({ state: 'detached' });
  });
  await run('server error, network failure, not found', async () => {
    await page.route('**/api/boards', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/boards'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByRole('heading', { name: 'Your boards' }).waitFor();
    await page.goto(url + '#/b/999'); await page.getByText('Board not found').waitFor();
  });
  await run('XSS in card title is inert; delete board', async () => {
    await page.goto(url + '#/'); await page.getByRole('link', { name: 'Launch plan' }).click(); await addCard('To do', '<img src=x onerror=window.__x=1>');
    assert.equal(await page.evaluate(() => window.__x), undefined);
    await page.goto(url + '#/'); await page.getByRole('button', { name: 'Delete board Launch plan' }).click(); await page.click('#confirm-ok'); await page.getByText('No boards yet').waitFor();
  });
  await run('mobile: board scrolls inside its own container, page does not overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    await mp.goto(url); await mp.fill('#board-name', 'M'); await mp.click('#create-board'); await mp.getByRole('heading', { name: 'M', exact: true }).waitFor();
    assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
