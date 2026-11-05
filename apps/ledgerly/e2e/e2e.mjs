import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp({ now: () => new Date('2026-03-31T12:00:00Z') }); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
const api = async (m, p, b) => (await fetch(`${url}api${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })).json();
try {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 }, timezoneId: 'UTC' })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date('2026-03-31T12:00:00Z') });
  const text = (s) => page.locator(s).textContent();
  const fillLine = async (i, account, debit, credit) => { const row = page.locator('.lines tbody tr').nth(i); await row.locator('select').selectOption({ label: account }); await row.getByLabel('Debit').fill(debit); await row.getByLabel('Credit').fill(credit); };
  await run('empty journal; chart of accounts is pre-seeded', async () => { await page.goto(url); await page.getByText('No entries yet').waitFor(); await page.locator('#nav-accounts').click(); await page.locator('[data-code="1000"]').waitFor(); assert.ok((await page.locator('#accounts tbody tr').count()) >= 8); });
  await run('entry form shows the running balance and rejects an unbalanced entry (server message)', async () => {
    await page.locator('#nav-new').click(); await page.locator('#memo').fill('Owner invests'); await fillLine(0, '1000 Cash', '10,000', ''); await page.locator('#balance').getByText('off by 10,000.00').waitFor(); await fillLine(1, '3000 Owner’s Equity', '', '9,999.99');
    await page.locator('#balance').getByText('off by 0.01').waitFor(); await page.locator('#post').click(); await page.locator('#form-error').getByText('out of balance by 0.01').waitFor();
    await fillLine(1, '3000 Owner’s Equity', '', '10000'); await page.locator('#balance').getByText('Balanced · 10,000.00').waitFor(); assert.ok((await page.locator('#balance').getAttribute('class')).includes('ok'));
    await page.locator('#post').click(); await page.locator('[data-entry]').waitFor(); assert.match(await text('[data-entry]'), /Owner invests/); assert.match(await text('[data-entry]'), /10,000\.00/);
  });
  await run('"Add line" supports split entries', async () => {
    await page.locator('#nav-new').click(); await page.locator('#add-line').click(); assert.equal(await page.locator('.lines tbody tr').count(), 3); await page.locator('#memo').fill('Rent and supplies in cash'); await fillLine(0, '5000 Rent', '1,500', ''); await fillLine(1, '5100 Supplies', '300.50', ''); await fillLine(2, '1000 Cash', '', '1800.50');
    await page.locator('#post').click(); await page.locator('[data-entry]').nth(1).waitFor();
  });
  await run('seed sales via API; reports balance and match hand-computed totals', async () => {
    const acc = Object.fromEntries((await api('GET', '/accounts')).map((a) => [a.name, a.id])); await api('POST', '/entries', { day: '2026-03-20', memo: 'Sale', lines: [{ account: acc.Cash, debit: '5000' }, { account: acc.Sales, credit: '5000' }] }); await api('POST', '/entries', { day: '2026-03-22', memo: 'Equipment on credit', lines: [{ account: acc.Equipment, debit: '800' }, { account: acc['Accounts Payable'], credit: '800' }] });
    await page.goto(url + '#/reports?from=2026-03-01&to=2026-03-31'); await page.locator('#trial').waitFor(); assert.equal(await text('#tb-debit'), await text('#tb-credit')); assert.match(await text('#tb-status'), /Debits equal credits/);
    assert.equal(await text('#net-income'), '3,199.50'); assert.equal(await text('#sheet-total'), '13,999.50'); assert.match(await text('#sheet-status'), /Assets = liabilities/);   // cash 13,199.50 + equipment 800 = payable 800 + equity 10,000 + net income 3,199.50
  });
  await run('account ledger: running balance', async () => {
    await page.goto(url + '#/accounts'); await page.locator('[data-code="1000"] a').click(); await page.locator('#ledger').waitFor(); const bal = await page.locator('#ledger tbody tr td:last-child').allTextContents(); assert.deepEqual(bal, ['5,000.00', '15,000.00', '13,199.50'], 'ordered by date: the 03-20 sale first, then the two 03-31 entries');
  });
  await run('voiding posts a reversal; both shown; reports still balance; no second void', async () => {
    await page.goto(url); const sale = page.locator('[data-entry]', { hasText: 'Equipment on credit' }); await sale.locator('[data-void]').click(); await page.locator('[data-entry].void').waitFor(); assert.equal(await page.locator('[data-entry]', { hasText: 'Void of' }).count(), 1);
    assert.equal(await page.locator('[data-entry].void [data-void]').count(), 0); await page.goto(url + '#/reports?from=2026-03-01&to=2026-03-31'); await page.locator('#tb-status').waitFor(); assert.match(await text('#tb-status'), /✓/);
  });
  await run('add an account, archive it: it disappears from the entry form', async () => {
    await page.goto(url + '#/accounts'); await page.locator('#acode').fill('5400'); await page.locator('#aname').fill('Software'); await page.locator('#atype').selectOption('expense'); await page.getByRole('button', { name: 'Add account' }).click(); await page.locator('[data-code="5400"]').waitFor();
    await page.locator('#acode').fill('5400'); await page.locator('#aname').fill('Dup'); await page.getByRole('button', { name: 'Add account' }).click(); await page.locator('#form-error').getByText('already used').waitFor();
    await page.getByRole('button', { name: 'Archive Software' }).click(); await page.locator('[data-code="5400"].void').waitFor(); await page.locator('#nav-new').click(); await page.locator('.lines select').first().waitFor(); assert.equal(await page.locator('.lines select').first().locator('option', { hasText: 'Software' }).count(), 0);
  });
  await run('mobile: no horizontal overflow on any screen', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); for (const h of ['#/', '#/new', '#/accounts', '#/reports?from=2026-03-01&to=2026-03-31']) { await page.goto(url + h); await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); }
    await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
