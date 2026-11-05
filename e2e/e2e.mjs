// End-to-end test: real server + real Chromium. Run: npm run test:e2e
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
const run = async (name, fn) => { step = name; await fn(); console.log('✓', name); };

try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of 4|status of 5|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await run('first visit shows empty state', async () => {
    await page.goto(url);
    await page.getByText('Start your decision journal').waitFor();
  });
  await run('validation errors on empty form', async () => {
    await page.click('#new-btn');
    await page.click('#save');
    await page.getByText('Title is required').waitFor();
    await page.getByText('State what you expect to happen').waitFor();
  });
  const create = async (title, prediction, conf, review) => {
    await page.goto(url + '#/new');
    await page.fill('[name=title]', title);
    await page.fill('[name=prediction]', prediction);
    await page.fill('[name=confidence]', String(conf));
    await page.fill('[name=decidedAt]', '2019-12-01');
    await page.fill('[name=reviewOn]', review);
    await page.fill('[name=tags]', 'Work, Test');
    await page.click('#save');
    await page.getByRole('heading', { name: title }).waitFor();
  };
  await run('create decision, persists after reload', async () => {
    await create('Adopt TypeScript', 'Fewer bugs', 80, '2020-01-01');
    await page.reload();
    await page.getByRole('heading', { name: 'Adopt TypeScript' }).waitFor();
    await page.getByText('Review due').first().waitFor();
  });
  await run('edit decision', async () => {
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.fill('[name=title]', 'Adopt TypeScript everywhere');
    await page.click('#save');
    await page.getByRole('heading', { name: 'Adopt TypeScript everywhere' }).waitFor();
  });
  await run('review decision as miss', async () => {
    await page.getByLabel('Prediction was wrong').check();
    await page.fill('[name=outcomeNote]', 'Migration cost more than expected');
    await page.getByRole('button', { name: 'Save review' }).click();
    await page.getByText('Migration cost more than expected').waitFor();
  });
  await run('overview + calibration reflect review', async () => {
    await page.goto(url + '#/');
    await page.locator('.stat', { hasText: 'Reviewed' }).getByText('1', { exact: true }).waitFor();
    assert.equal(await page.getByText('[object').count(), 0, 'stringified DOM node leaked into UI');
    await page.getByRole('heading', { name: 'Coming up' }).waitFor();
    await page.goto(url + '#/calibration');
    await page.locator('svg.chart').waitFor();
    await page.screenshot({ path: 'e2e/shots/calibration.png' });
  });
  await run('journal search & filter', async () => {
    await create('Hire a designer', 'Better UX', 65, '2099-01-01');
    await page.goto(url + '#/journal');
    await page.fill('#q', 'designer');
    assert.equal(await page.locator('.item').count(), 1);
    await page.fill('#q', '');
    await page.selectOption('#status', 'reviewed');
    assert.equal(await page.locator('.item').count(), 1);
    await page.fill('#q', 'zzzz');
    await page.getByText('No decisions match').waitFor();
    await page.screenshot({ path: 'e2e/shots/journal.png' });
  });
  await run('delete with confirmation', async () => {
    await page.selectOption('#status', 'all'); await page.fill('#q', 'designer');
    await page.getByRole('link', { name: 'Hire a designer' }).click();
    await page.click('#del'); await page.click('#confirm-del');
    await page.getByRole('heading', { name: 'Journal' }).waitFor();
    assert.equal(await page.locator('.item', { hasText: 'Hire a designer' }).count(), 0);
  });
  await run('unknown decision shows not-found', async () => {
    await page.goto(url + '#/d/9999');
    await page.getByText('Decision not found').waitFor();
  });
  await run('server error surfaces a retry banner', async () => {
    await page.route('**/api/decisions', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/journal');
    await page.getByRole('alert').getByText('Internal server error').waitFor();
    await page.unroute('**/api/decisions');
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('heading', { name: 'Journal' }).waitFor();
  });
  await run('network failure surfaces message', async () => {
    await page.route('**/api/stats', (r) => r.abort());
    await page.goto(url + '#/calibration');
    await page.getByText('Network error').waitFor();
    await page.unroute('**/api/stats');
  });
  await run('XSS payload is rendered as text', async () => {
    await create('<img src=x onerror=window.__x=1>', 'p', 60, '2099-01-01');
    assert.equal(await page.evaluate(() => window.__x), undefined);
  });
  await run('mobile viewport has no horizontal overflow', async () => {
    const m = await browser.newContext({ viewport: { width: 375, height: 700 } });
    const mp = await m.newPage();
    for (const h of ['#/', '#/journal', '#/new', '#/calibration']) {
      await mp.goto(url + h); await mp.waitForTimeout(150);
      assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'overflow on ' + h);
    }
    await mp.goto(url + '#/'); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
    await m.close();
  });
  assert.deepEqual(errors, [], 'console/page errors: ' + errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) {
  console.error(`\n✗ FAILED at step "${step}":`, e.message);
  process.exitCode = 1;
} finally { await browser.close(); server.close(); }
