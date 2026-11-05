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
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const bal = (n) => page.locator('#balances li', { hasText: n }).locator('span').last();
  const addExpense = async (desc, amount, paidBy) => { await page.fill('[name=description]', desc); await page.fill('[name=amount]', amount); await page.selectOption('[name=paidBy]', { label: paidBy }); };

  await run('empty state and group validation', async () => {
    await page.goto(url); await page.getByText('No groups yet').waitFor();
    await page.click('#create-group'); await page.getByText('Name is required').waitFor(); await page.getByText('Add at least two people').waitFor();
    await page.fill('#group-name', 'Lisbon'); await page.fill('#group-members', 'Ann\nann'); await page.click('#create-group'); await page.getByText('Duplicate name').waitFor();
  });
  await run('create group', async () => {
    await page.selectOption('[name=currency]', 'EUR'); await page.fill('#group-members', 'Ann, Bob\nCy'); await page.click('#create-group');
    await page.getByRole('heading', { name: 'Lisbon' }).waitFor(); await page.getByText('Add an expense to get started.').waitFor();
  });
  await run('equal split with an odd cent; balances; total', async () => {
    await addExpense('Dinner', '100', 'Ann'); await page.getByText('3 people, about €33.33 each').waitFor(); await page.click('#save-expense');
    await page.locator('[data-expense]', { hasText: 'Dinner' }).waitFor(); assert.equal(await page.locator('#total').textContent(), '€100.00');
    assert.equal(await bal('Ann').textContent(), 'gets back €66.66'); assert.equal(await bal('Bob').textContent(), 'owes €33.33'); assert.equal(await bal('Cy').textContent(), 'owes €33.33');
    await page.reload(); await page.locator('[data-expense]', { hasText: 'Dinner' }).waitFor(); assert.equal(await bal('Ann').textContent(), 'gets back €66.66');
  });
  await run('exact split: live helper, mismatch error, then success', async () => {
    await page.fill('[name=description]', 'Museum'); await page.fill('[name=amount]', '30'); await page.selectOption('[name=paidBy]', { label: 'Bob' });
    await page.click('[data-split=exact]'); await page.fill('[data-val="1"]', '10'); await page.getByText('€20.00 left to assign').waitFor();
    await page.click('#save-expense'); await page.getByText(/add up to 10.00 but the total is 30.00/).waitFor();
    const ids = await page.locator('[data-val]').evaluateAll((l) => l.map((i) => i.dataset.val));
    await page.fill(`[data-val="${ids[1]}"]`, '5.50'); await page.fill(`[data-val="${ids[2]}"]`, '14.50'); await page.getByText('Amounts match the total ✓').waitFor(); await page.click('#save-expense');
    await page.locator('[data-expense]', { hasText: 'Museum' }).waitFor();
  });
  await run('percent split validation', async () => {
    await page.fill('[name=description]', 'Taxi'); await page.fill('[name=amount]', '10'); await page.click('[data-split=percent]');
    const ids = await page.locator('[data-val]').evaluateAll((l) => l.map((i) => i.dataset.val));
    await page.fill(`[data-val="${ids[0]}"]`, '60'); await page.fill(`[data-val="${ids[1]}"]`, '60'); await page.click('#save-expense'); await page.getByText('Percentages must add up to 100').waitFor();
    await page.fill(`[data-val="${ids[1]}"]`, '40'); await page.click('#save-expense'); await page.locator('[data-expense]', { hasText: 'Taxi' }).waitFor();
  });
  await run('form validation for amount / description', async () => {
    await page.click('#save-expense'); await page.getByText('Description is required').waitFor(); await page.getByText('Enter a positive amount').waitFor();
    await page.fill('[name=description]', 'x'); await page.fill('[name=amount]', '1.999'); await page.click('#save-expense'); await page.getByText('Enter a positive amount').waitFor();
  });
  await run('edit an expense (exact conversion preserves amounts)', async () => {
    await page.getByRole('button', { name: 'Edit Dinner' }).click(); await page.getByRole('heading', { name: 'Edit expense' }).waitFor();
    await page.fill('[name=amount]', '90'); await page.click('#save-expense'); await page.getByText('Expense saved').waitFor();
    await page.locator('[data-expense]', { hasText: 'Dinner' }).getByText('€90.00').waitFor();
    await page.getByRole('button', { name: 'Edit Museum' }).click(); assert.equal(await page.locator('[data-split=exact][aria-pressed=true]').count(), 1); await page.getByRole('button', { name: 'Cancel' }).click();
  });
  await run('settle up: suggestions clear all balances via recorded payments', async () => {
    const before = await page.locator('#suggestions li').count(); assert.ok(before >= 1 && before <= 2);
    for (let i = 0; i < before; i++) { await page.locator('[data-pay]').first().click(); await page.getByText('Payment recorded').first().waitFor(); await page.waitForTimeout(150); }
    await page.locator('#all-settled').waitFor(); for (const n of ['Ann', 'Bob', 'Cy']) assert.equal(await bal(n).textContent(), 'settled up');
    await page.screenshot({ path: 'e2e/shots/settled.png' });
    await page.getByRole('button', { name: 'Undo payment' }).first().click(); await page.locator('#suggestions').waitFor();
  });
  await run('delete an expense with confirmation', async () => {
    await page.getByRole('button', { name: 'Delete Taxi' }).click(); await page.click('#confirm-ok'); await page.locator('[data-expense]', { hasText: 'Taxi' }).waitFor({ state: 'detached' });
  });
  await run('people: duplicate rejected, add, remove protection', async () => {
    await page.fill('#member-name', 'ann'); await page.locator('form:has(#member-name) button').click(); await page.getByText('already in this group').waitFor();
    await page.fill('#member-name', 'Dee'); await page.keyboard.press('Enter'); await page.getByText('Person added').waitFor(); await page.locator('#balances li', { hasText: 'Dee' }).waitFor();
    await page.getByRole('button', { name: 'Remove Ann' }).click(); await page.getByText(/cannot be removed/).waitFor();
    await page.getByRole('button', { name: 'Remove Dee' }).click(); await page.locator('#balances li', { hasText: 'Dee' }).waitFor({ state: 'detached' });
  });
  await run('server error, network failure, not found', async () => {
    await page.route('**/api/groups', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/groups'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByRole('heading', { name: 'Your groups' }).waitFor();
    await page.goto(url + '#/g/999'); await page.getByText('Group not found').waitFor();
  });
  await run('XSS in names is inert; delete group', async () => {
    await page.goto(url + '#/'); await page.fill('#group-name', '<img src=x onerror=window.__x=1>'); await page.fill('#group-members', '<b>A</b>, B'); await page.click('#create-group');
    await page.getByRole('heading', { name: '<img src=x onerror=window.__x=1>' }).waitFor(); assert.equal(await page.evaluate(() => window.__x), undefined);
    await page.click('#del-group'); await page.click('#confirm-ok'); await page.getByRole('heading', { name: 'Your groups' }).waitFor();
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    await mp.goto(url); await mp.getByRole('link', { name: 'Lisbon' }).click(); await mp.locator('#balances').waitFor();
    for (const hash of ['#/', '#/g/1']) {
      await mp.goto(url + hash); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(300);
      const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`));
      assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow on ${hash}: ${over.join(', ')}`);
    }
    await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
