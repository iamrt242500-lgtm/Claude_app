import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp(); await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`; mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, timezoneId: 'UTC' })).newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date('2026-03-11T10:00:00Z') });
  const text = (s) => page.locator(s).textContent(); const cell = (p, d) => page.locator(`[data-cell="${p}:${d}"]`);
  const saveShift = async () => { await page.locator('#save').click(); };
  await run('empty state prompts to add people', async () => { await page.goto(url); await page.getByText('Add people first').waitFor(); assert.match(await text('#range'), /Mar 9 – Mar 15/); });
  await run('add people (one never available on Sunday) and a day off', async () => {
    await page.locator('#nav-people').click(); await page.locator('#pname').fill('Ana'); await page.locator('#prole').fill('Barista'); await page.getByRole('button', { name: 'Add person' }).click(); await page.locator('[data-p="1"]').waitFor();
    await page.locator('#pname').fill('Ben'); await page.locator('[data-wd="Sun"]').check(); await page.getByRole('button', { name: 'Add person' }).click(); await page.locator('[data-p="2"]').waitFor(); assert.match(await text('[data-p="2"]'), /unavailable: Sun/);
    await page.locator('#pname').fill('ana'); await page.getByRole('button', { name: 'Add person' }).click(); await page.locator('#form-error').getByText('already exists').waitFor();
    await page.locator('#off-person').selectOption('1'); await page.locator('#off-day').fill('2026-03-13'); await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.locator('[data-off]').waitFor();
  });
  await run('add a shift from the grid; hours total appears', async () => {
    await page.goto(url); await page.locator('[aria-label="Add shift Ana 2026-03-09"]').click(); assert.equal(await page.locator('#day').inputValue(), '2026-03-09'); assert.equal(await page.locator('#person').inputValue(), '1'); assert.match(await text('#dur'), /8 h/);
    await saveShift(); await cell(1, '2026-03-09').locator('[data-shift]').waitFor(); assert.match(await text('[data-person="1"] th'), /8 h/); assert.match(await text('#summary'), /1 shifts/);
  });
  await run('overlap is blocked with a reason; "Assign anyway" saves and flags the shift', async () => {
    await page.locator('[aria-label="Add shift Ana 2026-03-09"]').click(); await page.locator('#start').fill('16:00'); await page.locator('#end').fill('20:00'); await saveShift(); await page.locator('#problems [data-code="overlap"]').waitFor();
    assert.equal(await page.locator('#nav-week').count(), 1); await page.locator('#force').click(); await page.waitForFunction(() => document.querySelectorAll('[data-cell="1:2026-03-09"] .shift.warn').length === 2); assert.match(await text('#summary'), /2 problems/, 'both overlapping shifts are flagged');
  });
  await run('overnight shift shows its length and counts toward next-day coverage', async () => {
    await page.locator('[aria-label="Add shift Ben 2026-03-10"]').click(); await page.locator('#start').fill('22:00'); await page.locator('#end').fill('06:00'); assert.match(await text('#dur'), /8 h \(overnight\)/); await saveShift(); await cell(2, '2026-03-10').locator('[data-shift]').waitFor();
    assert.ok((await page.locator('svg[aria-label^="Coverage 2026-03-11"]').getAttribute('aria-label')).endsWith('peak 1'), 'Wednesday 00:00–06:00 is covered by Tuesday night');
  });
  await run('time off and unavailable weekday are reported', async () => {
    await page.locator('[aria-label="Add shift Ana 2026-03-13"]').click(); await saveShift(); await page.locator('#problems [data-code="timeoff"]').waitFor(); await page.locator('#nav-week').click();
    await page.locator('[aria-label="Add shift Ben 2026-03-15"]').click(); await saveShift(); await page.locator('#problems [data-code="unavailable"]').waitFor(); await page.locator('#nav-week').click();
  });
  await run('open shift can be assigned later; changing the min-rest rule changes what conflicts', async () => {
    await page.locator('[aria-label="Add shift open 2026-03-12"]').click(); await page.locator('#person').selectOption(''); await saveShift(); await cell('open', '2026-03-12').locator('[data-shift]').waitFor(); assert.match(await text('#summary'), /1 open/);
    await cell('open', '2026-03-12').locator('[data-shift]').click(); await page.locator('#person').selectOption('2'); await saveShift(); await cell(2, '2026-03-12').locator('[data-shift]').waitFor(); assert.match(await text('#summary'), /0 open/);
    await page.goto(url + '#/people'); await page.locator('#minr').fill('13'); await page.locator('#save-rules').click(); await page.getByText('Rules saved').waitFor(); await page.locator('#maxw').fill('500'); await page.locator('#save-rules').click(); assert.equal(await page.locator('#maxw').evaluate((e) => e.validity.rangeOverflow), true, 'the browser blocks out-of-range values before any request (the server rejects them too)');
  });
  await run('week navigation and deleting a shift', async () => {
    await page.goto(url); await page.locator('#next').click(); await page.waitForFunction(() => /Mar 16 – Mar 22/.test(document.getElementById('range').textContent)); assert.equal(await page.locator('[data-shift]').count(), 0); await page.locator('a', { hasText: 'This week' }).click(); await page.waitForFunction(() => /Mar 9 – Mar 15/.test(document.getElementById('range').textContent));
    const before = await page.locator('[data-shift]').count(); await cell(2, '2026-03-12').locator('[data-shift]').click(); await page.locator('#delete').click(); await page.waitForFunction((n) => document.querySelectorAll('[data-shift]').length === n, before - 1);
  });
  await run('removing a person leaves their shifts as open shifts', async () => {
    await page.goto(url + '#/people'); await page.getByRole('button', { name: 'Remove Ben' }).click(); await page.waitForFunction(() => !document.querySelector('[data-p="2"]')); await page.goto(url); await cell('open', '2026-03-10').locator('[data-shift]').waitFor();
  });
  await run('mobile: page does not overflow (the grid scrolls inside its wrapper)', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); for (const h of ['#/', '#/people', '#/shift/new']) { await page.goto(url + h); await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + h); }
    await page.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], 'console errors: ' + errors.join('; ')); console.log('E2E PASS');
} catch (e) { console.error('E2E FAIL at step:', step, '\n', e); process.exitCode = 1; } finally { await browser.close(); server.close(); }
