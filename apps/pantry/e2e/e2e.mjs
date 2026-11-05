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
const mondayOf = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const now = new Date(), pad = (n) => String(n).padStart(2, '0'), today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1000 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of [45]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const ings = async () => page.locator('#ingredients-list li').allTextContents();
  const newRecipe = async (title, servings, lines) => { await page.goto(url + '#/new'); await page.fill('#title', title); await page.fill('#servings', String(servings)); await page.fill('#ingredients', lines.join('\n')); await page.click('#save'); await page.getByRole('heading', { name: title, exact: true }).waitFor(); };

  await run('empty state; recipe form validation reports every problem', async () => {
    await page.goto(url); await page.getByText('No recipes yet').waitFor(); await page.click('#new-recipe'); await page.fill('#servings', '0'); await page.click('#save');
    await page.getByText('Title is required').waitFor(); await page.getByText('Servings must be a whole number').waitFor(); await page.getByText('Add at least one ingredient').waitFor();
  });
  await run('create a recipe; ingredients are parsed and shown with nice fractions', async () => {
    await newRecipe('Pancakes', 4, ['1 1/2 cups all-purpose flour, sifted', '2 tbsp sugar', '1 cup milk', '2 eggs', '½ tsp salt', 'butter for frying']);
    assert.deepEqual(await ings(), ['1½ cup all-purpose flour, sifted', '2 tbsp sugar', '1 cup milk', '2 eggs', '½ tsp salt', 'butter for frying']);
    await page.screenshot({ path: 'e2e/shots/recipe.png' });
  });
  await run('scale servings: doubling, halving and the −/+ limits; stored recipe is untouched', async () => {
    await page.click('[aria-label="More servings"]'); await page.click('[aria-label="More servings"]'); await page.click('[aria-label="More servings"]'); await page.click('[aria-label="More servings"]'); assert.equal(await page.locator('#servings-out').textContent(), '8');
    await page.waitForFunction(() => document.querySelector('#ingredients-list li')?.textContent.startsWith('3 cup')); assert.deepEqual((await ings()).slice(0, 5), ['3 cup all-purpose flour, sifted', '4 tbsp sugar', '2 cup milk', '4 eggs', '1 tsp salt']);
    for (let i = 0; i < 6; i++) await page.click('[aria-label="Fewer servings"]'); assert.equal(await page.locator('#servings-out').textContent(), '2'); await page.waitForFunction(() => document.querySelector('#ingredients-list li')?.textContent.startsWith('¾ cup')); assert.deepEqual((await ings()).slice(0, 5), ['¾ cup all-purpose flour, sifted', '1 tbsp sugar', '½ cup milk', '1 eggs', '¼ tsp salt']);
    await page.reload(); await page.getByText('(recipe makes 4)').waitFor({ timeout: 1000 }).catch(() => {}); assert.deepEqual((await ings()).slice(0, 2), ['1½ cup all-purpose flour, sifted', '2 tbsp sugar']);
  });
  await run('unit conversion: metric and US, rounded sensibly', async () => {
    await page.click('[data-sys="metric"]'); await page.waitForFunction(() => document.querySelector('#ingredients-list li')?.textContent.includes('ml')); assert.deepEqual((await ings()).slice(0, 3), ['355 ml all-purpose flour, sifted', '30 ml sugar', '235 ml milk']);
    await page.click('[data-sys="original"]'); await page.waitForFunction(() => document.querySelector('#ingredients-list li')?.textContent.includes('cup'));
  });
  await run('edit the recipe: new weight-based ingredient; US conversion', async () => {
    await page.click('#edit'); await page.fill('#ingredients', '500 g spaghetti\n2 tbsp olive oil\n3 cloves garlic, minced'); await page.click('#save'); await page.waitForFunction(() => document.querySelector('#ingredients-list li')?.textContent.startsWith('500 g'));
    await page.click('[data-sys="us"]'); await page.waitForFunction(() => document.querySelector('#ingredients-list li')?.textContent.includes('lb')); assert.deepEqual((await ings()).slice(0, 2), ['1.1 lb spaghetti', '2 tbsp olive oil']);
    await page.click('#edit'); await page.fill('#ingredients', '1 1/2 cups all-purpose flour, sifted\n2 tbsp sugar\n1 cup milk\n2 eggs\n½ tsp salt\nbutter for frying'); await page.fill('#title', 'Pancakes'); await page.click('#save'); await page.getByRole('heading', { name: 'Pancakes', exact: true }).waitFor();
  });
  await run('second recipe, search by title and by ingredient', async () => {
    await newRecipe('Omelette', 2, ['3 eggs', '250 ml milk', '1 tbsp butter']); await page.goto(url + '#/'); const only = async (title) => { await page.waitForFunction((t) => { const l = [...document.querySelectorAll('[data-recipe]')]; return l.length === 1 && l[0].dataset.recipe === t; }, title); };
    await page.fill('#search', 'omel'); await only('Omelette');
    await page.fill('#search', 'sugar'); await only('Pancakes'); await page.fill('#search', 'zzzz'); await page.getByText('No recipes match.').waitFor(); await page.fill('#search', '');
  });
  await run('meal plan from the recipe page (servings carried over) and from the week grid', async () => {
    await page.locator('[data-recipe="Pancakes"] a').first().click(); await page.getByRole('heading', { name: 'Pancakes', exact: true }).waitFor(); for (let i = 0; i < 4; i++) await page.click('[aria-label="More servings"]');
    await page.fill('#plan-day', today); await page.selectOption('#plan-meal', 'breakfast');
    await page.waitForTimeout(400);   // let any in-flight re-render from the servings clicks land: the chosen day/meal must survive it
    assert.equal(await page.inputValue('#plan-meal'), 'breakfast', 'plan form selections survive re-renders'); await page.getByRole('button', { name: 'Add (8 servings)' }).click(); await page.getByText(/Planned for/).waitFor();
    await page.goto(url + '#/plan'); const day = page.locator(`[data-day="${today}"]`); await day.locator('[data-entry="Pancakes"]').getByText('8 serv.').waitFor();
    await day.locator('select[name="recipeId"]').selectOption({ label: 'Omelette' }); await day.locator('select[name="meal"]').selectOption('lunch'); await day.getByRole('button', { name: 'Add', exact: true }).click(); await day.locator('[data-entry="Omelette"]').getByText('2 serv.').waitFor();
    assert.equal(await day.locator('.entry .meal').first().textContent(), 'breakfast', 'entries are ordered breakfast → lunch');
  });
  await run('regression: a slow response after changing servings must not reset the plan form the user already filled in', async () => {
    await page.goto(url + '#/'); await page.locator('[data-recipe="Omelette"] a').first().click(); await page.getByRole('heading', { name: 'Omelette', exact: true }).waitFor();
    await page.route('**/api/recipes/*', async (r) => { await new Promise((res) => setTimeout(res, 700)); await r.continue(); });
    await page.click('[aria-label="More servings"]'); await page.selectOption('#plan-meal', 'snack'); await page.fill('#plan-day', today);   // chosen while the servings response is still in flight
    await page.waitForTimeout(1200); assert.equal(await page.inputValue('#plan-meal'), 'snack', 'meal choice survived the late re-render'); assert.equal(await page.inputValue('#plan-day'), today);
    await page.unroute('**/api/recipes/*');
  });
  await run('shopping list merges ingredients across recipes and units; tick items; persists', async () => {
    await page.goto(url + '#/shopping'); await page.locator('#shop').waitFor(); const q = async (name) => page.locator(`[data-item="${name}"] .q`).textContent();
    assert.equal(await q('eggs'), '7', '4 eggs (pancakes ×2) + 3 eggs'); assert.equal(await q('milk'), '725 ml', '2 cups + 250 ml'); assert.equal(await q('all-purpose flour'), '710 ml'); assert.equal(await q('sugar'), '59 ml');
    await page.screenshot({ path: 'e2e/shots/shopping.png' });
    await page.click('[data-sys="us"]'); await page.waitForFunction(() => document.querySelector('[data-item="milk"] .q')?.textContent.includes('cup')); assert.equal(await q('milk'), '3.06 cup'); await page.click('[data-sys="metric"]');
    await page.locator('[data-item="eggs"] input').check(); await page.locator('[data-item="eggs"].done').waitFor(); await page.getByText('1 of').waitFor(); await page.reload(); await page.locator('[data-item="eggs"].done').waitFor(); assert.equal(await page.locator('[data-item="eggs"] input').isChecked(), true);
    await page.locator('[data-item="eggs"] input').uncheck(); await page.locator('[data-item="eggs"]:not(.done)').waitFor();
  });
  await run('week navigation: next week is empty and independent', async () => {
    await page.click('#next-week'); await page.getByText('Nothing planned this week').waitFor(); await page.click('#prev-week'); await page.locator('#shop').waitFor(); assert.equal(await page.locator('#week-label').textContent().then((t) => t.length > 5), true);
  });
  await run('remove a plan entry; deleting a recipe removes it from the plan', async () => {
    await page.goto(url + '#/plan'); const day = page.locator(`[data-day="${today}"]`); await day.getByRole('button', { name: /Remove Omelette/ }).click(); await day.locator('[data-entry="Omelette"]').waitFor({ state: 'detached' });
    await page.goto(url + '#/'); await page.locator('[data-recipe="Pancakes"] a').first().click(); await page.click('#del'); await page.click('#confirm-ok'); await page.getByText('Recipe deleted').waitFor(); await page.locator('#recipes').waitFor(); assert.equal(await page.locator('[data-recipe="Pancakes"]').count(), 0);
    await page.goto(url + '#/plan'); await page.locator(`[data-day="${today}"]`).getByText('Nothing planned').waitFor({ timeout: 4000 }).catch(async (e) => { throw new Error('main shows: ' + (await page.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 300) + ' | url ' + page.url()); });
  });
  await run('server error, network failure, not found', async () => {
    await page.route('**/api/recipes', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' })); await page.goto(url + '#/'); await page.reload(); await page.getByRole('alert').getByText('Internal server error').waitFor(); await page.unroute('**/api/recipes'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByRole('heading', { name: 'Recipes' }).waitFor();
    await page.goto(url + '#/r/9999'); await page.getByText('Recipe not found').waitFor();
  });
  await run('XSS in title and ingredients is inert', async () => {
    await newRecipe('<img src=x onerror=window.__x=1>', 2, ['2 cups <b>flour</b>']); assert.equal(await page.evaluate(() => window.__x), undefined); assert.equal(await page.locator('#ingredients-list b').count(), 0);
  });
  await run('mobile: no horizontal overflow', async () => {
    const mp = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
    for (const h of ['#/', '#/plan', '#/shopping', '#/new']) { await mp.goto(url + h); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(250); const over = await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className || ''}`)); assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow on ${h}: ${over.join(', ')}`); }
    await mp.goto(url + '#/plan'); await mp.waitForTimeout(250); await mp.screenshot({ path: 'e2e/shots/mobile.png' });
  });
  assert.deepEqual(errors, [], errors.join('; '));
  console.log('\nAll E2E steps passed');
} catch (e) { console.error(`\n✗ FAILED at "${step}":`, e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
