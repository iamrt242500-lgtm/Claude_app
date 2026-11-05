import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { server } = createApp({ limits: { create: 100, vote: 100 } });
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 'init'; const run = async (n, f) => { step = n; await f(); console.log('✓', n); };
const errors = [];
const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text())); return p; };
const newVoter = async () => watch(await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage());   // separate context = separate cookies = a different person
let owner, links = {};
try {
  owner = await newVoter();
  const create = async (page, { q, opts, multi, mode, closes }) => {
    await page.goto(url); await page.fill('#question', q); for (const [i, o] of opts.entries()) { if (i >= 2) await page.click('#add-opt'); await page.locator('.optin').nth(i).fill(o); }
    if (multi) await page.check('#multi'); if (mode) await page.selectOption('#mode', mode); if (closes) await page.fill('#closes', closes); await page.click('#create'); await page.locator('#created').waitFor();
    return { pub: await page.inputValue('#public-link'), adm: await page.inputValue('#admin-link') };
  };

  await run('create form validation, then create a poll and receive public + admin links', async () => {
    await owner.goto(url); await owner.click('#create'); await owner.getByText('Question is required').waitFor(); await owner.getByText('Add at least 2 options').waitFor();
    await owner.fill('#question', 'Lunch?'); await owner.locator('.optin').nth(0).fill('Pizza'); await owner.locator('.optin').nth(1).fill('pizza'); await owner.click('#create'); await owner.getByText('Options must be different').waitFor();
    links = await create(owner, { q: 'Lunch?', opts: ['Pizza', 'Sushi', 'Salad'] }); assert.match(links.pub, /#\/p\/[\w-]{8,}$/); assert.match(links.adm, /#\/a\/[\w-]{30,}$/); assert.notEqual(links.pub.split('/').at(-1), links.adm.split('/').at(-1)); await owner.getByText('shown only once').waitFor();
    await owner.screenshot({ path: 'e2e/shots/created.png' });
  });
  await run('a visitor votes; results appear; re-voting changes (never adds) the vote; persists after reload', async () => {
    const v1 = await newVoter(); await v1.goto(links.pub); await v1.getByRole('heading', { name: 'Lunch?' }).waitFor(); await v1.locator('.choice', { hasText: 'Pizza' }).locator('input').check(); await v1.click('#vote'); await v1.getByText('Vote recorded').waitFor();
    await v1.locator('[data-opt="Pizza"]').getByText('1 · 100%').waitFor(); await v1.locator('[data-opt="Pizza"].mine').waitFor();
    await v1.locator('.choice', { hasText: 'Sushi' }).locator('input').check(); await v1.getByRole('button', { name: 'Change my vote' }).click(); await v1.locator('[data-opt="Sushi"]').getByText('1 · 100%').waitFor(); await v1.locator('[data-opt="Pizza"]').getByText('0 · 0%').waitFor(); await v1.locator('#total').getByText('1 vote').waitFor();
    await v1.reload(); await v1.locator('[data-opt="Sushi"].mine').waitFor();
    const v2 = await newVoter(); await v2.goto(links.pub); await v2.locator('.choice', { hasText: 'Sushi' }).locator('input').check(); await v2.click('#vote'); await v2.locator('#total').getByText('2 votes').waitFor(); await v2.locator('[data-opt="Sushi"]').getByText('2 · 100%').waitFor();
  });
  await run('admin page: full results, voter count, link, view-as-voter', async () => {
    await owner.goto(links.adm); await owner.locator('#results').waitFor(); await owner.locator('#total').getByText('2 votes from 2 voters').waitFor(); assert.equal(await owner.inputValue('#public-link'), links.pub); await owner.screenshot({ path: 'e2e/shots/admin.png' });
  });
  await run('multiple-choice poll with "results after vote": hidden until the visitor votes', async () => {
    const l = await create(owner, { q: 'Which days?', opts: ['Mon', 'Tue', 'Wed'], multi: true, mode: 'after_vote' });
    const v = await newVoter(); await v.goto(l.pub); await v.locator('#results-hidden').getByText('Vote to see the results').waitFor(); assert.equal(await v.locator('#results').count(), 0);
    await v.locator('.choice', { hasText: 'Mon' }).locator('input').check(); await v.locator('.choice', { hasText: 'Wed' }).locator('input').check(); await v.click('#vote'); await v.locator('#total').getByText('2 votes').waitFor();
    await v.locator('.choice', { hasText: 'Mon' }).locator('input').uncheck(); await v.getByRole('button', { name: 'Change my vote' }).click(); await v.locator('#total').getByText('1 vote').waitFor();
    await v.locator('.choice input:checked').first().uncheck(); await v.getByRole('button', { name: 'Change my vote' }).click(); await v.getByText('Choose at least one option').waitFor();
  });
  await run('"results after close": voters wait, admin closes, results appear, voting stops; reopen works', async () => {
    const l = await create(owner, { q: 'Secret ballot', opts: ['Yes', 'No'], mode: 'after_close' });
    const v = await newVoter(); await v.goto(l.pub); await v.locator('.choice', { hasText: 'Yes' }).locator('input').check(); await v.click('#vote'); await v.getByText('Results will be visible when the poll closes').waitFor();
    await owner.goto(l.adm); await owner.click('#close'); await owner.getByText('Poll closed').waitFor(); await owner.locator('.badge.closed').waitFor();
    await v.reload(); await v.locator('#results').waitFor(); await v.getByText('This poll is closed').waitFor(); assert.equal(await v.locator('#vote').count(), 0);
    await owner.click('#reopen'); await owner.getByText('Poll reopened').waitFor(); await v.reload(); await v.locator('#vote').waitFor();
  });
  await run('voting on a poll that closes while the page is open shows a clear error', async () => {
    const l = await create(owner, { q: 'Race', opts: ['A', 'B'] }); const v = await newVoter(); await v.goto(l.pub); await v.locator('.choice', { hasText: 'A' }).locator('input').check();
    await owner.goto(l.adm); await owner.click('#close'); await owner.getByText('Poll closed').waitFor(); await v.click('#vote'); await v.getByText('This poll is closed').first().waitFor(); assert.equal(await v.locator('#vote').count(), 0);
  });
  await run('deadline in the past is rejected; a future deadline is accepted', async () => {
    await owner.goto(url); await owner.fill('#question', 'Deadline'); await owner.locator('.optin').nth(0).fill('x'); await owner.locator('.optin').nth(1).fill('y'); await owner.fill('#closes', '2020-01-01T10:00'); await owner.click('#create'); await owner.getByText('must be in the future').waitFor();
    const f = new Date(Date.now() + 86400000), pad = (n) => String(n).padStart(2, '0'); await owner.fill('#closes', `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}T10:00`); await owner.click('#create'); await owner.locator('#created').waitFor();
  });
  await run('delete poll with confirmation; both links then give "Poll not found"', async () => {
    const l = await create(owner, { q: 'Temp', opts: ['a', 'b'] }); await owner.goto(l.adm); await owner.click('#del'); await owner.click('#confirm-del'); await owner.getByText('Create a poll').first().waitFor();
    await owner.goto(l.pub); await owner.getByText('Poll not found').waitFor(); await owner.goto(l.adm); await owner.reload(); await owner.getByText('Poll not found').waitFor();
  });
  await run('wrong/guessed admin link and slug-as-admin never work', async () => {
    const slug = links.pub.split('/').at(-1); await owner.goto(url + '#/a/' + slug); await owner.getByText('Poll not found').waitFor(); await owner.goto(url + '#/a/aaaaaaaaaaaaaaaaaaaaaaaaaaaa'); await owner.getByText('Poll not found').waitFor();
  });
  await run('server error and network failure are shown', async () => {
    const p = await newVoter(); await p.route('**/api/polls/*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' })); await p.goto(links.pub); await p.getByRole('alert').getByText('Internal server error').waitFor(); await p.unroute('**/api/polls/*'); await p.getByRole('button', { name: 'Retry' }).click(); await p.locator('#vote').waitFor();
    await p.route('**/api/polls/*/vote', (r) => r.abort()); await p.locator('.choice').first().locator('input').check(); await p.click('#vote'); await p.getByText('Network error').waitFor();
  });
  await run('XSS in question and options is inert', async () => {
    const l = await create(owner, { q: '<img src=x onerror=window.__q=1>', opts: ['<b>x</b>', 'y'] }); const v = await newVoter(); await v.goto(l.pub); await v.getByText('<b>x</b>').first().waitFor(); assert.equal(await v.evaluate(() => window.__q), undefined);
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = watch(await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage());
    for (const u of [url, links.pub, links.adm]) { await mp.goto(u); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(300);
      const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`)); assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow on ${u}: ${over.join(', ')}`); }
    await mp.goto(links.pub); await mp.waitForTimeout(300); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
