import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const pancakes = { title: 'Pancakes', servings: 4, ingredients: '1 1/2 cups flour\n2 tbsp sugar\n1 cup milk\n2 eggs\nsalt to taste', steps: 'Mix. Fry.' };
const omelette = { title: 'Omelette', servings: 2, ingredients: ['3 eggs', '250 ml milk', '1 tbsp butter'] };

test('recipe CRUD and validation (all errors together); search by title and ingredient', async () => {
  const bad = await call('POST', '/recipes', { title: '', servings: 0, ingredients: [] }); assert.equal(bad.status, 422); assert.deepEqual(Object.keys((await bad.json()).details).sort(), ['ingredients', 'servings', 'title']);
  const r = await (await call('POST', '/recipes', pancakes)).json(); assert.equal(r.ingredients.length, 5); assert.equal(r.view.ingredients[0].text, '1½ cup flour');
  const u = await (await call('PUT', `/recipes/${r.id}`, { ...pancakes, title: 'Fluffy pancakes' })).json(); assert.equal(u.title, 'Fluffy pancakes');
  assert.equal((await (await call('GET', '/recipes?q=fluffy')).json()).length, 1); assert.equal((await (await call('GET', '/recipes?q=sugar')).json()).length, 1); assert.equal((await (await call('GET', '/recipes?q=zzz')).json()).length, 0);
  assert.equal((await call('DELETE', `/recipes/${r.id}`)).status, 204); assert.equal((await call('GET', `/recipes/${r.id}`)).status, 404);
});
test('scaled and converted view: servings and unit system', async () => {
  const r = await (await call('POST', '/recipes', pancakes)).json();
  const v8 = await (await call('GET', `/recipes/${r.id}?servings=8`)).json(); assert.equal(v8.view.factor, 2); assert.deepEqual(v8.view.ingredients.map((i) => i.text), ['3 cup flour', '4 tbsp sugar', '2 cup milk', '4 eggs', 'salt to taste']);
  const m = await (await call('GET', `/recipes/${r.id}?system=metric&servings=2`)).json(); assert.equal(m.view.ingredients[0].text, '175 ml flour');   // 4 → 2 servings: 1½ cups × ½ = ¾ cup = 177 ml ≈ 175 ml assert.equal(m.view.ingredients[1].text, '15 ml sugar'); assert.equal(m.view.ingredients[2].text, '120 ml milk');
  assert.equal((await call('GET', `/recipes/${r.id}?servings=0`)).status, 422); assert.equal((await call('GET', `/recipes/${r.id}?system=imperial`)).status, 422); assert.equal(v8.ingredients[0], '1 1/2 cups flour', 'stored lines are never rewritten by scaling');
});
test('weekly plan: add entries (default servings), validation, ordering by meal, delete', async () => {
  const r = await (await call('POST', '/recipes', omelette)).json();
  for (const [b, key] of [[{ day: '2026-03-02', meal: 'brunch', recipeId: r.id }, 'meal'], [{ day: '2026-02-30', meal: 'lunch', recipeId: r.id }, 'day'], [{ day: '2026-03-02', meal: 'lunch', recipeId: 99999 }, 'recipeId'], [{ day: '2026-03-02', meal: 'lunch', recipeId: r.id, servings: 0 }, 'servings']]) { const x = await call('POST', '/plan', b); assert.equal(x.status, 422); assert.ok((await x.json()).details[key], key); }
  await call('POST', '/plan', { day: '2026-03-03', meal: 'dinner', recipeId: r.id, servings: 4 }); const p = await (await call('POST', '/plan', { day: '2026-03-03', meal: 'breakfast', recipeId: r.id })).json();
  assert.equal(p.week, '2026-03-02', 'weeks start on Monday'); assert.deepEqual(p.entries.map((e) => [e.meal, e.servings]), [['breakfast', 2], ['dinner', 4]]);
  const week = await (await call('GET', '/plan?week=2026-03-05')).json(); assert.equal(week.week, '2026-03-02'); assert.equal(week.days.length, 7); assert.equal(week.entries.length, 2); assert.equal((await call('GET', '/plan?week=nope')).status, 422);
  assert.equal((await call('DELETE', `/plan/${week.entries[0].id}`)).status, 204); assert.equal((await call('DELETE', `/plan/${week.entries[0].id}`)).status, 404);
});
test('shopping list: merges the same ingredient across recipes/units, scales by planned servings, metric/US, check state per week', async () => {
  const a = await (await call('POST', '/recipes', pancakes)).json(), o = await (await call('POST', '/recipes', omelette)).json();
  await call('POST', '/plan', { day: '2026-04-06', meal: 'breakfast', recipeId: a.id, servings: 8 });   // x2 : 3 cup flour, 4 tbsp sugar, 2 cup milk, 4 eggs
  await call('POST', '/plan', { day: '2026-04-07', meal: 'lunch', recipeId: o.id, servings: 2 });        // 3 eggs, 250 ml milk, 1 tbsp butter
  const l = await (await call('GET', '/shopping?week=2026-04-06&system=metric')).json(); const by = Object.fromEntries(l.items.map((i) => [i.key, i]));
  assert.equal(by['egg|count'].qtyText, '7'); assert.equal(by['milk|volume'].qtyText, '725 ml', '2 cups (473.2 ml) + 250 ml = 723.2 ml → nearest 5 ml'); assert.equal(by['flour|volume'].qtyText, '710 ml'); assert.equal(by['butter|volume'].qtyText, '15 ml'); assert.equal(by['sugar|volume'].qtyText, '59 ml', '4 US tbsp = 59.15 ml'); assert.equal(l.items.filter((i) => i.dim === 'none').length, 1, 'salt to taste');
  const us = await (await call('GET', '/shopping?week=2026-04-06&system=us')).json(); assert.equal(us.items.find((i) => i.name === 'milk').qtyText, '3.06 cup'); assert.equal((await call('GET', '/shopping?week=2026-04-06&system=original')).status, 422);
  const key = by['egg|count'].key; let c = await (await call('POST', '/shopping/check?week=2026-04-06', { item: key, checked: true })).json(); assert.equal(c.items.find((i) => i.key === key).checked, true);
  assert.equal((await (await call('GET', '/shopping?week=2026-04-07')).json()).items.find((i) => i.key === key).checked, true, 'any day of the week addresses the same list'); assert.equal((await (await call('GET', '/shopping?week=2026-04-13')).json()).items.length, 0, 'next week is separate');
  c = await (await call('POST', '/shopping/check?week=2026-04-06', { item: key, checked: false })).json(); assert.equal(c.items.find((i) => i.key === key).checked, false);
  assert.equal((await call('POST', '/shopping/check?week=2026-04-06', { item: 'nonsense|x', checked: true })).status, 404); assert.equal((await call('POST', '/shopping/check?week=2026-04-06', { item: key })).status, 422);
});
test('deleting a recipe removes it from the plan; errors and static', async () => {
  const r = await (await call('POST', '/recipes', omelette)).json(); await call('POST', '/plan', { day: '2026-05-04', meal: 'lunch', recipeId: r.id }); await call('DELETE', `/recipes/${r.id}`); assert.equal((await (await call('GET', '/plan?week=2026-05-04')).json()).entries.length, 0);
  assert.equal((await call('GET', '/recipes/abc')).status, 400); assert.equal((await fetch(base + '/api/recipes', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  const m = await fetch(base + '/food.js'); assert.equal(m.status, 200); assert.match(await m.text(), /export function parseIngredient/);
});
