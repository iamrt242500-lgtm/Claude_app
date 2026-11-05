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
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 1000 } })).newPage();
  const errors = []; let dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const q = (i) => page.locator(`[data-q="${i}"]`);
  const pickChoice = async (text) => page.locator('.choice', { hasText: text }).locator('input').check();

  await run('empty state; editor validation shows path-specific errors', async () => {
    await page.goto(url); await page.getByText('No quizzes yet').waitFor(); await page.click('#new-quiz'); await page.click('#save-quiz');
    await page.getByText('Title is required').waitFor(); await page.getByText('Question text is required').waitFor(); await page.getByText('Options cannot be empty').waitFor();
  });
  await run('build a 3-question quiz in the editor (single, multi, short)', async () => {
    await page.fill('#title', 'World basics'); await page.fill('#desc', 'A short test');
    await q(0).locator('.qprompt').fill('Capital of France?'); await q(0).locator('.qopt').nth(0).fill('Paris'); await q(0).locator('.qopt').nth(1).fill('Rome'); await q(0).getByRole('button', { name: '+ Add option' }).click(); await q(0).locator('.qopt').nth(2).fill('Oslo');
    await q(0).locator('.qexp').fill('Paris is on the Seine.'); await page.click('#save-quiz'); await page.getByText('Mark the correct answer').waitFor();
    await q(0).locator('.qcorrect').nth(0).check();
    await page.click('#add-q'); await q(1).locator('.qtype').selectOption('multi'); await q(1).locator('.qprompt').fill('Which are prime?');
    const opts = ['2', '3', '4', '5']; for (const [k, o] of opts.entries()) { if (k >= 2) await q(1).getByRole('button', { name: '+ Add option' }).click(); await q(1).locator('.qopt').nth(k).fill(o); }
    for (const k of [0, 1, 3]) await q(1).locator('.qcorrect').nth(k).check();
    await page.click('#add-q'); await q(2).locator('.qtype').selectOption('short'); await q(2).locator('.qprompt').fill('Largest ocean?'); await q(2).locator('.qans').nth(0).fill('Pacific');
    await q(2).getByRole('button', { name: '+ Another accepted answer' }).click(); await q(2).locator('.qans').nth(1).fill('Pacific Ocean');
    await page.click('#save-quiz'); await page.locator('[data-quiz="World basics"]').getByText('3 questions · 0 attempts').waitFor();
  });
  await run('the answer key is NOT sent to the browser while taking the quiz', async () => {
    let playBody = ''; page.on('response', async (r) => { if (r.url().includes('/play')) playBody = await r.text(); });
    await page.locator('[data-quiz="World basics"]').getByRole('link', { name: 'Take quiz' }).click(); await page.locator('#pos').waitFor();
    assert.ok(playBody.length > 0); assert.ok(!/"correct"|"answers"|"explanation"/.test(playBody), 'play payload leaks the key'); assert.ok(!playBody.includes('Pacific Ocean'));
    assert.equal(await page.locator('body').innerText().then((t) => /Paris is on the Seine/.test(t)), false);
  });
  await run('take the quiz with shuffled order; progress; back button keeps answers; perfect score', async () => {
    const prompts = {}; const answerCurrent = async () => {
      const t = await page.locator('#qprompt').textContent(); prompts[t] = true;
      if (t.startsWith('Capital')) await pickChoice('Paris'); else if (t.startsWith('Which')) { for (const n of ['2', '3', '5']) await pickChoice(new RegExp(`^[A-H]\\. ${n}$`)); } else await page.fill('#short', ' pacific OCEAN. ');
    };
    for (let n = 0; n < 3; n++) { await answerCurrent(); if (n < 2) { if (n === 0) { await page.click('#next'); await page.click('#prev'); assert.ok((await page.locator('.choice input:checked').count()) >= 1 || (await page.locator('#short').inputValue()) !== '', 'answer kept after Back'); } await page.click('#next'); } }
    assert.equal(Object.keys(prompts).length, 3); await page.click('#finish'); await page.locator('#score').getByText('100%').waitFor(); await page.getByText('Perfect!').waitFor(); await page.screenshot({ path: 'e2e/shots/result.png' });
    assert.equal(await page.locator('.rev.ok').count(), 3);
  });
  await run('retake with wrong/partial/blank answers: server grades, review shows the key and explanation', async () => {
    dialogs = []; await page.click('#retake'); await page.locator('#pos').waitFor();
    for (let n = 0; n < 3; n++) {
      const t = await page.locator('#qprompt').textContent();
      if (t.startsWith('Capital')) await pickChoice('Rome'); else if (t.startsWith('Which')) { for (const x of ['2', '3']) await pickChoice(new RegExp(`^[A-H]\\. ${x}$`)); }   // partial: 2 of 3 correct
      if (n < 2) await page.click('#next');
    }
    await page.click('#finish'); assert.match(dialogs[0], /1 question is unanswered/); await page.locator('#score').waitFor(); assert.equal(await page.locator('#score').textContent(), '22%');
    const review = (name) => page.locator('.rev', { hasText: name });
    await review('Capital').getByText('✗ Incorrect').waitFor(); await review('Capital').getByText('Correct answer: A. Paris').waitFor(); await review('Capital').getByText('Paris is on the Seine.').waitFor();
    await review('Which are prime').getByText('◐ Partly correct (67%)').waitFor(); await review('Largest ocean').getByText('“Pacific” or “Pacific Ocean”').waitFor();
  });
  await run('history and list stats', async () => {
    await page.goto(url + '#/'); await page.locator('[data-quiz="World basics"]').getByText('2 attempts · best 100% · last 22%').waitFor();
    await page.locator('[data-quiz="World basics"]').getByRole('link', { name: 'History' }).click(); await page.locator('#history li').first().getByText('22%').waitFor(); assert.equal(await page.locator('#history li').count(), 2);
  });
  await run('edit: reorder, remove option adjusts correct index, save; history survives', async () => {
    await page.goto(url + '#/'); await page.getByRole('link', { name: 'Edit World basics' }).click(); await page.locator('[data-q="0"]').waitFor();
    await q(0).getByRole('button', { name: 'Remove option B' }).click(); assert.equal(await q(0).locator('.qopt').count(), 2); assert.equal(await q(0).locator('.qcorrect').nth(0).isChecked(), true);
    await page.getByRole('button', { name: 'Move question 3 up' }).click(); assert.equal(await q(1).locator('.qprompt').inputValue(), 'Largest ocean?');
    await page.click('#save-quiz'); await page.locator('[data-quiz="World basics"]').getByText('2 attempts').waitFor();
  });
  await run('delete with confirmation', async () => {
    await page.getByRole('button', { name: 'Delete World basics' }).click(); await page.click('#confirm-ok'); await page.getByText('No quizzes yet').waitFor();
  });
  await run('server error, network failure, not found', async () => {
    await page.route('**/api/quizzes', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' }));
    await page.goto(url + '#/'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor(); await page.unroute('**/api/quizzes'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByText('No quizzes yet').waitFor();
    await page.goto(url + '#/play/9999'); await page.getByText('Quiz not found').waitFor();
  });
  await run('XSS in quiz title, question and options is inert', async () => {
    await page.goto(url + '#/new'); await page.fill('#title', '<img src=x onerror=window.__a=1>'); await q(0).locator('.qprompt').fill('<img src=x onerror=window.__b=1>'); await q(0).locator('.qopt').nth(0).fill('<b>x</b>'); await q(0).locator('.qopt').nth(1).fill('y'); await q(0).locator('.qcorrect').nth(0).check(); await page.click('#save-quiz');
    await page.getByText('<img src=x onerror=window.__a=1>').first().waitFor(); await page.getByRole('link', { name: 'Take quiz' }).click(); await page.getByText('<b>x</b>').waitFor();
    assert.deepEqual(await page.evaluate(() => [window.__a, window.__b]), [undefined, undefined]);
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    for (const hsh of ['#/', '#/new', '#/play/2']) {
      await mp.goto(url + hsh); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(300);
      const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`));
      assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow on ${hsh}: ${over.join(', ')}`);
    }
    await mp.goto(url + '#/new'); await mp.waitForTimeout(300); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
