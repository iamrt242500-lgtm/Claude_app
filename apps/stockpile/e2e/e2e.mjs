import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp({ now: () => new Date('2026-03-31T12:00:00Z') }); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 }, timezoneId: 'UTC' })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date('2026-03-31T12:00:00Z') });
  const text = (s) => page.locator(s).textContent();
  const record = async (type, qty, day, cost = '', note = '') => { const before = await page.locator('#history tbody tr').count(); await page.locator('#mtype').selectOption(type); await page.locator('#mqty').fill(String(qty)); if (cost) await page.locator('#mcost').fill(cost); await page.locator('#mday').fill(day); await page.locator('#mnote').fill(note); await page.locator('#record').click(); return before; };
  const recorded = async (before) => page.waitForFunction((n) => document.querySelectorAll('#history tbody tr').length === n + 1, before);
  await run('add an item; duplicate SKU is rejected', async () => {
    await page.goto(url); await page.getByText('No items yet').waitFor(); await page.locator('#sku').fill('bolt'); await page.locator('#name').fill('M6 Bolt'); await page.locator('#unit').fill('pcs'); await page.locator('#rp').fill('20'); await page.getByRole('button', { name: 'Add item' }).click(); await page.locator('[data-sku="BOLT"]').waitFor();
    await page.locator('#sku').fill('BOLT'); await page.locator('#name').fill('Again'); await page.getByRole('button', { name: 'Add item' }).click(); await page.locator('#form-error').getByText('already in use').waitFor();
  });
  await run('two receipts at different costs create two layers', async () => {
    await page.locator('[data-sku="BOLT"] a').click(); await page.locator('#mtype').waitFor(); let b = await record('receive', 100, '2026-03-01', '0.10', 'first lot'); await recorded(b); b = await record('receive', 100, '2026-03-10', '0.12'); await recorded(b);
    assert.equal(await page.locator('#lots tbody tr').count(), 2); assert.match(await text('#onhand'), /^200 pcs/);
  });
  await run('FIFO issue: cost is 100×0.10 + 30×0.12 = 13.60; remaining layer is the newer one', async () => {
    const b = await record('issue', 130, '2026-03-15'); await recorded(b); const row = page.locator('#history tbody tr').first(); assert.match(await row.textContent(), /issue/); assert.match(await row.textContent(), /13\.60/); assert.equal(await row.locator('td').nth(4).textContent(), '70');
    assert.equal(await page.locator('#lots tbody tr').count(), 1); assert.match(await text('#lots tbody tr'), /70.*0\.12.*8\.40/);
  });
  await run('stock can’t go negative; the error explains why', async () => {
    await record('issue', 100, '2026-03-16'); await page.locator('#form-error').getByText('Only 70 on hand').waitFor(); await record('issue', 1, '2026-02-20'); await page.locator('#form-error').getByText('Only 0 on hand on 2026-02-20').waitFor();
  });
  await run('a receipt that later issues depend on cannot be deleted', async () => {
    await page.locator('#history tbody tr', { hasText: 'first lot' }).locator('button').click(); await page.getByText('Can’t remove this').waitFor(); assert.equal(await page.locator('#history tbody tr').count(), 3);
  });
  await run('negative adjustment is shrinkage at FIFO cost; cost field is disabled for removals', async () => {
    await page.locator('#mtype').selectOption('adjust'); await page.locator('#mqty').fill('-5'); assert.equal(await page.locator('#mcost').isDisabled(), true); const b = await page.locator('#history tbody tr').count(); await page.locator('#mday').fill('2026-03-18'); await page.locator('#mnote').fill('damaged'); await page.locator('#record').click(); await recorded(b);
    assert.match(await text('#history tbody tr:has-text("damaged")'), /0\.60/);
  });
  await run('dropping to the reorder point flags the item everywhere', async () => {
    const b = await record('issue', 50, '2026-03-20'); await recorded(b); assert.match(await text('#onhand'), /^15 pcs/); assert.ok((await page.locator('#onhand').getAttribute('class')).includes('low'));
    await page.goto(url); await page.locator('[data-sku="BOLT"] .chip', { hasText: 'Reorder' }).waitFor(); assert.match(await text('#summary'), /1 low/); await page.locator('#low-toggle').click(); await page.waitForFunction(() => /show all/.test(document.getElementById('low-toggle').textContent)); assert.equal(await page.locator('#items tbody tr').count(), 1);
  });
  await run('reports: valuation, COGS vs shrinkage, reorder list', async () => {
    await page.goto(url + '#/reports'); await page.locator('#valuation').waitFor(); assert.equal(await text('#val-total'), '1.80');   // 15 × 0.12
    assert.equal(await text('#cogs-total'), '19.60'); assert.equal(await text('#shrink-total'), '0.60');   // 13.60 + 50×0.12 = 19.60
    await page.locator('#asof').fill('2026-03-14'); await page.waitForFunction(() => document.getElementById('val-total').textContent === '22.00'); await page.locator('#reorder [data-sku="BOLT"]').waitFor();
  });
  await run('archiving removes the entry form', async () => {
    await page.goto(url); await page.locator('[data-sku="BOLT"] a').click(); await page.locator('#archive').click(); await page.getByText('Archived — no new movements').waitFor(); assert.equal(await page.locator('#record').count(), 0);
  });
  await run('mobile: no horizontal overflow on any screen', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); for (const h of ['#/', '#/item/1', '#/reports']) { await page.goto(url + h); await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); }
    await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
