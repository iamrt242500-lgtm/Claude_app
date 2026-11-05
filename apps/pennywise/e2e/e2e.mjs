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
const d = new Date(), ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, today = `${ym}-${String(d.getDate()).padStart(2, '0')}`;
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'UTC' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const addTx = async (type, amount, note, cat) => { await page.goto(url + '#/transactions'); await page.locator('#tx-form').waitFor(); await page.click(`[data-type=${type}]`); await page.fill('#amount', amount); await page.fill('#note', note); if (cat) await page.selectOption('#categoryId', { label: cat }); await page.click('#save-tx'); await page.locator('tr', { hasText: note }).waitFor(); };
  const stat = (l) => page.locator('.stat', { hasText: l }).locator('b');

  await run('empty overview', async () => { await page.goto(url); await page.getByText('Nothing here yet').waitFor(); });
  await run('categories: validation, add with budget, duplicate rejected', async () => {
    await page.goto(url + '#/categories'); await page.click('#add-cat'); await page.getByText('Name is required').waitFor();
    await page.fill('#cat-name', 'Food'); await page.fill('#cat-budget', 'abc'); await page.click('#add-cat'); await page.getByText('Budget must be a positive amount').waitFor();
    await page.fill('#cat-budget', '$200.00'); await page.click('#add-cat'); await page.locator('[data-cat="Food"]').getByText('Budget $200.00 / month').waitFor();
    await page.fill('#cat-name', 'food'); await page.click('#add-cat'); await page.getByText('already exists').waitFor();
    await page.goto(url + '#/categories'); await page.fill('#cat-name', 'Fun'); await page.click('#add-cat'); await page.locator('[data-cat="Fun"]').waitFor();
  });
  await run('transaction validation; add income and expenses', async () => {
    await page.goto(url + '#/transactions'); await page.click('#save-tx'); await page.getByText('Enter a positive amount').waitFor();
    await page.fill('#amount', '-5'); await page.click('#save-tx'); await page.getByText('Enter a positive amount').waitFor();
    await page.fill('#amount', '3,000'); await page.click('[data-type=income]'); await page.fill('#note', 'Salary'); await page.click('#save-tx'); await page.locator('tr', { hasText: 'Salary' }).waitFor();
    await addTx('expense', '150', 'Groceries', 'Food'); await addTx('expense', '60.5', 'Pizza night', 'Food'); await addTx('expense', '25', 'Cinema', 'Fun'); await addTx('expense', '12', 'Mystery');
  });
  await run('overview: totals, budget progress (over budget), uncategorized, charts', async () => {
    await page.goto(url + '#/'); await page.locator('#cat-list').waitFor();
    assert.equal(await stat('Income').textContent(), '$3,000.00'); assert.equal(await stat('Spent').textContent(), '$247.50'); assert.equal(await stat('Net').textContent(), '$2,752.50');
    const food = page.locator('[data-cat="Food"]'); await food.getByText('over budget').waitFor(); await food.getByText('$210.50 of $200.00').waitFor(); await food.getByText('$10.50 over').waitFor(); assert.equal(await food.locator('progress.over').count(), 1);
    await page.locator('[data-cat="Uncategorized"]').getByText('$12.00').waitFor(); assert.equal(await page.locator('svg[aria-label="Spending per day this month"] rect').count() >= 28, true); assert.equal(await page.locator('svg[aria-label^="Income and expenses"] rect').count(), 12);
    await page.screenshot({ path: 'e2e/shots/overview.png' });
  });
  await run('month navigation: other months are empty and independent; persistence after reload', async () => {
    await page.click('#prev-month'); await page.getByText('Nothing here yet').waitFor({ timeout: 5000 }).catch(async () => { await page.locator('#cat-list').waitFor(); }); assert.equal(await stat('Spent').textContent(), '$0.00');
    await page.click('#next-month'); await page.locator('#cat-list').waitFor(); assert.equal(await stat('Spent').textContent(), '$247.50'); await page.reload(); await page.locator('#cat-list').waitFor(); assert.equal(await stat('Spent').textContent(), '$247.50');
  });
  await run('edit and delete a transaction; search and type filter', async () => {
    await page.goto(url + '#/transactions'); await page.getByRole('button', { name: 'Edit Pizza night' }).click(); await page.fill('#amount', '40'); await page.click('#save-tx'); await page.getByText('Transaction saved').waitFor(); await page.locator('tr', { hasText: 'Pizza night' }).getByText('−$40.00').waitFor();
    await page.fill('#search', 'cinema'); assert.equal(await page.locator('tbody tr').count(), 1); await page.fill('#search', ''); await page.selectOption('#type-filter', 'income'); assert.equal(await page.locator('tbody tr').count(), 1); await page.selectOption('#type-filter', 'all');
    await page.getByRole('button', { name: 'Delete Mystery' }).click(); await page.click('#confirm-ok'); await page.locator('tr', { hasText: 'Mystery' }).waitFor({ state: 'detached' });
  });
  await run('edit category budget; deleting a category keeps its transactions', async () => {
    await page.goto(url + '#/categories'); await page.getByRole('button', { name: 'Edit Food' }).click(); await page.fill('input[aria-label="Monthly budget"]', '500'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.locator('[data-cat="Food"]').getByText('Budget $500.00').waitFor();
    await page.getByRole('button', { name: 'Delete Fun' }).click(); await page.click('#confirm-ok'); await page.locator('[data-cat="Fun"]').waitFor({ state: 'detached' });
    await page.goto(url + '#/transactions'); await page.locator('tr', { hasText: 'Cinema' }).getByText('Uncategorized').waitFor();
  });
  await run('CSV import: preview (dupes, bad lines), date format, commit, re-import is a no-op', async () => {
    await page.goto(url + '#/import'); await page.fill('#csv', 'foo,bar\n1,2'); await page.click('#analyze'); await page.getByText(/Could not find a date column/).waitFor();
    const csv = `Date,Description,Amount,Category\n${ym.slice(5)}/10/${ym.slice(0, 4)},Bookstore,-23.99,Fun\n${ym.slice(5)}/10/${ym.slice(0, 4)},Bookstore,-23.99,Fun\n${ym.slice(5)}/11/${ym.slice(0, 4)},Refund,"(15.00)",\n99/99/2026,Broken,-1,\n${ym.slice(5)}/12/${ym.slice(0, 4)},Bad amount,abc,`;
    await page.fill('#csv', csv); await page.selectOption('#date-order', 'mdy'); await page.waitForTimeout(100); await page.click('#analyze');
    await page.locator('#summary-line').getByText('2 to import').waitFor(); await page.getByText('1 duplicate skipped').waitFor(); await page.getByText('2 invalid lines').waitFor(); await page.getByText('Line 5:').waitFor(); await page.screenshot({ path: 'e2e/shots/import.png' });
    await page.click('#do-import'); await page.getByText('Imported 2 transactions').waitFor(); await page.getByRole('heading', { name: 'Transactions' }).waitFor(); await page.locator('tr', { hasText: 'Bookstore' }).waitFor();
    await page.goto(url + '#/import'); await page.fill('#csv', csv); await page.selectOption('#date-order', 'mdy'); await page.click('#analyze'); await page.locator('#summary-line').getByText('0 to import').waitFor(); assert.equal(await page.locator('#do-import').isDisabled(), true);
  });
  await run('file upload import', async () => {
    const f = join(tmpdir(), 'pennywise.csv'); writeFileSync(f, `Posted,Memo,Debit,Credit\n${today},Rent,500.00,\n${today},Bonus,,75.00\n`);
    await page.goto(url + '#/import'); await page.setInputFiles('#file', f); await page.locator('#summary-line').getByText('2 to import').waitFor(); await page.click('#do-import'); await page.locator('tr', { hasText: 'Rent' }).waitFor(); await page.locator('tr', { hasText: 'Bonus' }).getByText('+$75.00').waitFor();
  });
  await run('export CSV download', async () => {
    await page.goto(url + '#/transactions'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]); assert.equal(dl.suggestedFilename(), 'pennywise.csv');
  });
  await run('server error, network failure', async () => {
    await page.route('**/api/summary*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor(); await page.unroute('**/api/summary*'); await page.getByRole('button', { name: 'Retry' }).click(); await page.locator('.stat').first().waitFor();
    await page.route('**/api/categories', (r) => r.abort()); await page.goto(url + '#/categories'); await page.reload(); await page.getByText('Network error').waitFor(); await page.unroute('**/api/categories');
  });
  await run('XSS in description is inert', async () => {
    await addTx('expense', '1', '<img src=x onerror=window.__x=1>'); assert.equal(await page.evaluate(() => window.__x), undefined);
  });
  await run('mobile: no horizontal page overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    for (const hsh of ['#/', '#/transactions', '#/categories', '#/import']) {
      await mp.goto(url + hsh); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(300);
      const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => !e.closest('.tablewrap') && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`));
      assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow on ${hsh}: ${over.join(', ')}`);
    }
    await mp.goto(url + '#/'); await mp.waitForTimeout(300); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
