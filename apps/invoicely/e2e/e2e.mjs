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
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await run('empty dashboard; invoice editor requires a client', async () => {
    await page.goto(url); await page.getByText('No invoices yet').waitFor();
    assert.equal(await page.getByText('[object').count(), 0);
    await page.click('#new-invoice'); await page.getByText('Add a client first').waitFor();
  });
  await run('client validation, add, edit', async () => {
    await page.goto(url + '#/clients'); await page.click('#save-client'); await page.getByText('Name is required').waitFor();
    await page.fill('[name=name]', 'Acme Corp'); await page.fill('[name=email]', 'nope'); await page.click('#save-client'); await page.getByText('Invalid email address').waitFor();
    assert.equal(await page.inputValue('[name=name]'), 'Acme Corp', 'form keeps typed values after error');
    await page.fill('[name=email]', 'billing@acme.io'); await page.fill('[name=address]', '1 Main St\nSpringfield'); await page.click('#save-client');
    await page.getByText('billing@acme.io · 0 invoices').waitFor();
    await page.getByRole('button', { name: 'Edit Acme Corp' }).click(); await page.fill('[name=name]', 'Acme Inc'); await page.click('#save-client'); await page.getByText('Acme Inc').waitFor();
  });
  await run('create invoice with live totals', async () => {
    await page.click('#new-invoice');
    await page.click('#save-invoice'); await page.getByText('description is required').waitFor();
    await page.locator('.f-desc').first().fill('Design work'); await page.locator('.f-qty').first().fill('10'); await page.locator('.f-price').first().fill('50');
    await page.click('#add-line'); await page.locator('.f-desc').nth(1).fill('Hosting'); await page.locator('.f-price').nth(1).fill('19.99');
    await page.fill('[name=taxPercent]', '10');
    assert.equal(await page.locator('#live-total').textContent(), '$571.99');   // 519.99 + 52.00
    await page.locator('.f-price').nth(1).fill('abc'); assert.equal(await page.locator('#live-total').textContent(), '$550.00');
    await page.click('#save-invoice'); await page.getByText('invalid unit price').waitFor();
    await page.locator('.f-price').nth(1).fill('19.99');
    await page.fill('[name=notes]', 'Thanks for your business');
    await page.click('#save-invoice');
    await page.getByRole('heading', { name: 'INVOICE' }).waitFor(); assert.equal(await page.locator('#inv-total').textContent(), '$571.99');
    await page.getByText('INV-0001').first().waitFor(); await page.screenshot({ path: 'e2e/shots/invoice.png' });
  });
  await run('edit draft, persists; remove line', async () => {
    await page.getByRole('link', { name: 'Edit' }).click(); await page.getByRole('button', { name: 'Remove line 2' }).click(); await page.click('#save-invoice');
    await page.getByRole('heading', { name: 'INVOICE' }).waitFor(); assert.equal(await page.locator('#inv-total').textContent(), '$550.00');
    await page.reload(); assert.equal(await page.locator('#inv-total').textContent(), '$550.00');
  });
  await run('status flow: draft → sent → paid → undo; edit locked after send', async () => {
    await page.click('#mark-sent'); await page.getByText('sent', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('link', { name: 'Edit' }).count(), 0); assert.equal(await page.locator('#del').count(), 0);
    await page.goto(url + '#/invoices/1/edit'); await page.getByText('Only draft invoices can be edited').waitFor();
    await page.goto(url + '#/invoices/1'); await page.click('#mark-paid'); await page.getByText(/Paid \d{4}-/).waitFor();
    await page.getByRole('button', { name: 'Undo payment' }).click(); await page.click('#mark-paid'); await page.getByText(/Paid \d{4}-/).waitFor();
  });
  await run('dashboard reflects paid revenue; list filters', async () => {
    await page.goto(url + '#/'); await page.locator('.stat', { hasText: 'Paid this year' }).getByText('$550.00').waitFor();
    await page.locator('svg, .bars').first().waitFor();
    assert.equal(await page.getByText('[object').count(), 0, 'stringified DOM node leaked');
    await page.screenshot({ path: 'e2e/shots/dashboard.png' });
    await page.goto(url + '#/invoices'); await page.getByRole('button', { name: 'Draft' }).click(); await page.getByText('No invoices match this filter').waitFor();
    await page.getByRole('button', { name: 'Paid' }).click(); await page.getByRole('link', { name: 'INV-0001' }).waitFor();
  });
  await run('client with invoices cannot be deleted; draft invoice can', async () => {
    await page.goto(url + '#/clients'); await page.getByRole('button', { name: 'Delete Acme Inc' }).click(); await page.click('#confirm-del'); await page.getByText('has invoices and cannot be deleted').waitFor();
    await page.goto(url + '#/invoices/new'); await page.locator('.f-desc').first().fill('Temp'); await page.locator('.f-price').first().fill('5'); await page.click('#save-invoice');
    await page.getByRole('heading', { name: 'INVOICE' }).waitFor(); await page.click('#del'); await page.click('#confirm-del');
    await page.getByRole('heading', { name: 'Invoices' }).waitFor();
  });
  await run('server error, network failure, not found', async () => {
    await page.route('**/api/invoices', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/invoices'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/invoices'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByRole('heading', { name: 'Invoices' }).waitFor();
    await page.route('**/api/summary', (r) => r.abort()); await page.goto(url + '#/'); await page.reload(); await page.getByText('Network error').waitFor(); await page.unroute('**/api/summary');
    await page.goto(url + '#/invoices/999'); await page.getByText('Invoice not found').waitFor();
  });
  await run('XSS in client name and notes is inert', async () => {
    await page.goto(url + '#/clients'); await page.fill('[name=name]', '<img src=x onerror=window.__x=1>'); await page.click('#save-client'); await page.getByText('<img src=x onerror=window.__x=1>').first().waitFor();
    assert.equal(await page.evaluate(() => window.__x), undefined);
  });
  await run('print stylesheet hides chrome', async () => {
    await page.goto(url + '#/invoices/1'); await page.getByRole('heading', { name: 'INVOICE' }).waitFor(); await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('header.top').isVisible(), false); assert.equal(await page.locator('#print').isVisible(), false); assert.ok(await page.locator('.paper').isVisible());
    await page.emulateMedia({ media: 'screen' });
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    for (const h of ['#/', '#/invoices', '#/invoices/new', '#/invoices/1', '#/clients']) { await mp.goto(url + h); await mp.waitForTimeout(250); assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); }
    await mp.goto(url + '#/invoices/new'); await mp.waitForTimeout(250); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
