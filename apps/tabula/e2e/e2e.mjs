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
const rowsCsv = 'city,sales,date\n' + Array.from({ length: 60 }, (_, i) => `${['Paris', 'Rome', 'Oslo'][i % 3]},${i + 1},2026-01-${String((i % 28) + 1).padStart(2, '0')}`).join('\n');
const file = join(tmpdir(), 'sales_e2e.csv'); writeFileSync(file, rowsCsv);
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await run('empty state and validation errors', async () => {
    await page.goto(url); await page.getByText('No datasets yet').waitFor();
    await page.click('#upload'); await page.getByText('Name is required').waitFor();
    await page.fill('#name', 'Broken'); await page.fill('#csv', 'a,b\n"unterminated,1'); await page.click('#upload');
    await page.getByText('Unterminated quoted field').waitFor();
    await page.fill('#csv', 'a,b'); await page.click('#upload'); await page.getByText('header row and at least one data row').waitFor();
  });
  await run('upload CSV file, see profile with types and histogram', async () => {
    await page.fill('#name', ''); await page.setInputFiles('#file', file);
    await page.waitForFunction(() => document.querySelector('#name').value === 'sales_e2e' && document.querySelector('#csv').value.length > 50);   // file is read asynchronously
    await page.click('#upload');
    await page.getByRole('heading', { name: 'sales_e2e' }).waitFor();
    await page.getByText('60 rows · 3 columns').waitFor();
    const sales = page.locator('.col-card', { hasText: 'sales' });
    await sales.getByText('number').waitFor();
    assert.equal(await sales.locator('dt:text-is("Mean") + dd').textContent(), '30.5');   // mean of 1..60
    assert.equal(await sales.locator('dt:text-is("Max") + dd').textContent(), '60');
    await sales.locator('svg rect').first().waitFor();
    await page.locator('.col-card', { hasText: 'date' }).getByText('date', { exact: true }).waitFor();
    await page.screenshot({ path: 'e2e/shots/profile.png' });
  });
  await run('data tab: paging, search, sorting, reload persistence', async () => {
    await page.click('#tab-data');
    await page.getByText('1–25 of 60').waitFor(); await page.click('#next'); await page.getByText('26–50 of 60').waitFor();
    await page.fill('#search', 'oslo'); await page.getByText('1–20 of 20').waitFor();
    await page.fill('#search', '');  await page.getByText('1–25 of 60').waitFor();
    await page.getByRole('button', { name: 'sales' }).click(); await page.getByRole('button', { name: 'sales' }).click();
    await page.locator('tbody tr').first().getByText('60', { exact: true }).waitFor();
    await page.fill('#search', 'zzzz'); await page.getByText('No rows match').waitFor();
    await page.reload(); await page.getByRole('heading', { name: 'sales_e2e' }).waitFor();
  });
  await run('chart tab: aggregates', async () => {
    await page.click('#tab-chart');
    await page.getByRole('heading', { name: 'count by city' }).waitFor();
    await page.selectOption('#group', 'city'); await page.selectOption('#fn', 'sum');
    await page.getByRole('heading', { name: 'sum of sales by city' }).waitFor();
    await page.locator('svg[aria-label="Aggregate chart"] rect').first().waitFor();
    assert.equal(await page.locator('svg[aria-label="Aggregate chart"] rect').count(), 3);
    await page.screenshot({ path: 'e2e/shots/chart.png' });
  });
  await run('server error, network failure, not found', async () => {
    await page.route('**/api/datasets', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/datasets'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByRole('heading', { name: 'Datasets' }).waitFor();
    await page.goto(url + '#/d/999'); await page.getByText('Dataset not found').waitFor();
  });
  await run('XSS in cell and header is inert', async () => {
    await page.goto(url + '#/'); await page.fill('#name', 'xss'); await page.fill('#csv', '<img src=x onerror=window.__x=1>,b\n<script>window.__x=2</script>,2'); await page.click('#upload');
    await page.getByRole('heading', { name: 'xss' }).waitFor(); await page.click('#tab-data'); await page.getByText('<script>window.__x=2</script>').waitFor();
    assert.equal(await page.evaluate(() => window.__x), undefined);
  });
  await run('delete dataset with confirmation', async () => {
    await page.goto(url + '#/'); await page.getByRole('button', { name: 'Delete xss' }).click(); await page.click('#confirm-del');
    await page.getByRole('link', { name: 'xss' }).waitFor({ state: 'detached' });
  });
  await run('mobile: no horizontal page overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    await mp.goto(url + '#/d/1'); await mp.getByRole('heading', { name: 'sales_e2e' }).waitFor();
    for (const t of ['profile', 'data', 'chart']) { await mp.click('#tab-' + t); await mp.waitForTimeout(250); assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + t); }
    await mp.click('#tab-profile'); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
