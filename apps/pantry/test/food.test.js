import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredient as P, toNumber, formatQty, renderIngredient as R, ingredientKey, aggregate, toBase, fromBase } from '../src/food.js';

test('toNumber: integers, decimals, fractions, mixed numbers, invalid', () => {
  assert.equal(toNumber('2'), 2); assert.equal(toNumber('0.5'), 0.5); assert.equal(toNumber('1/2'), 0.5); assert.equal(toNumber('1 1/2'), 1.5); assert.equal(toNumber('3 3/4'), 3.75); for (const bad of ['', 'x', '1/0', '1 1/0', '1.2.3', '-1']) assert.ok(Number.isNaN(toNumber(bad)), bad);
});
test('parseIngredient: the formats people actually write', () => {
  const cases = [
    ['1 1/2 cups all-purpose flour, sifted', { qty: { min: 1.5, max: 1.5 }, unit: 'cup', name: 'all-purpose flour', note: 'sifted' }],
    ['2 tbsp olive oil', { qty: { min: 2, max: 2 }, unit: 'tbsp', name: 'olive oil', note: '' }], ['500g spaghetti', { qty: { min: 500, max: 500 }, unit: 'g', name: 'spaghetti', note: '' }],
    ['½ tsp salt', { qty: { min: 0.5, max: 0.5 }, unit: 'tsp', name: 'salt', note: '' }], ['1½ cups milk', { qty: { min: 1.5, max: 1.5 }, unit: 'cup', name: 'milk', note: '' }], ['2 eggs', { qty: { min: 2, max: 2 }, unit: null, name: 'eggs', note: '' }],
    ['2-3 cloves garlic, minced', { qty: { min: 2, max: 3 }, unit: null, name: 'cloves garlic', note: 'minced' }], ['1 to 2 tbsp honey', { qty: { min: 1, max: 2 }, unit: 'tbsp', name: 'honey', note: '' }], ['1 lb. ground beef', { qty: { min: 1, max: 1 }, unit: 'lb', name: 'ground beef', note: '' }],
    ['3 fl oz cream', { qty: { min: 3, max: 3 }, unit: 'fl oz', name: 'cream', note: '' }], ['1 cup of sugar', { qty: { min: 1, max: 1 }, unit: 'cup', name: 'sugar', note: '' }], ['0.25 kg butter', { qty: { min: 0.25, max: 0.25 }, unit: 'kg', name: 'butter', note: '' }],
    ['1 (14 oz) can tomatoes', { qty: { min: 1, max: 1 }, unit: null, name: 'can tomatoes', note: '14 oz' }], ['  3   Tablespoons   sugar ', { qty: { min: 3, max: 3 }, unit: 'tbsp', name: 'sugar', note: '' }],
  ];
  for (const [raw, want] of cases) { const p = P(raw); assert.deepEqual({ qty: p.qty, unit: p.unit, name: p.name, note: p.note }, want, raw); }
});
test('parseIngredient: no quantity, garbage and hostile input never throw', () => {
  for (const raw of ['salt to taste', 'a pinch of nutmeg', 'Salt, to taste', '', '   ', null, undefined, '1/0 cup x', '99999999999999999999 g gold', '<img src=x onerror=1>', '3-1 cups x', '1/2', '2 cups']) assert.doesNotThrow(() => P(raw), String(raw));
  assert.equal(P('salt to taste').qty, null); assert.equal(P('Salt, to taste').name, 'Salt'); assert.equal(P('Salt, to taste').note, 'to taste'); assert.equal(P('').name, ''); assert.equal(P('3-1 cups x').qty.min, 3, 'descending "range" is not a range');
  assert.equal(P('<b>2</b> cups').qty, null); assert.equal(P('2 cups').name, '');
});
test('formatQty: nice fractions, decimals, rounding up to the next whole', () => {
  const t = { 0: '0', 0.5: '½', 1.5: '1½', 0.25: '¼', 2.75: '2¾', 0.3333333: '⅓', 0.6666667: '⅔', 0.125: '⅛', 3: '3', 2.37: '2⅜', 2.3: '2.3', 1.999: '2', 0.01: '0.01', 0.004: '0.004', 10.5: '10½', 0.99: '1' };
  for (const [n, s] of Object.entries(t)) assert.equal(formatQty(Number(n)), s, n); assert.equal(formatQty(NaN), ''); assert.equal(formatQty(-1), '');
});
test('toBase / fromBase conversions', () => {
  assert.equal(Math.round(toBase({ min: 1, max: 1 }, 'cup').min), 237); assert.equal(Math.round(toBase({ min: 2, max: 2 }, 'tbsp').min * 10) / 10, 29.6); assert.equal(toBase({ min: 2, max: 2 }, 'kg').min, 2000); assert.equal(toBase({ min: 3, max: 3 }, null).dim, 'count');
  assert.deepEqual(fromBase(2500, 'volume', 'metric'), { value: 2.5, unit: 'l' }); assert.equal(fromBase(250, 'volume', 'us').unit, 'cup'); assert.equal(fromBase(20, 'volume', 'us').unit, 'tbsp'); assert.equal(fromBase(5, 'volume', 'us').unit, 'tsp'); assert.equal(fromBase(1000, 'weight', 'metric').unit, 'kg'); assert.equal(fromBase(600, 'weight', 'us').unit, 'lb'); assert.equal(fromBase(100, 'weight', 'us').unit, 'oz');
});
test('renderIngredient: scaling, fractions, unit systems, ranges, no-quantity lines', () => {
  const r = (line, f, sys) => R(P(line), f, sys).text;
  assert.equal(r('1 1/2 cups flour', 2), '3 cup flour'); assert.equal(r('1 cup flour', 0.5), '½ cup flour'); assert.equal(r('1 cup flour', 1 / 3), '⅓ cup flour'); assert.equal(r('2 eggs', 1.5), '3 eggs'); assert.equal(r('2-3 cloves garlic', 2), '4–6 cloves garlic'); assert.equal(r('salt to taste', 3), 'salt to taste');
  assert.equal(r('1 cup milk', 1, 'metric'), '235 ml milk'); assert.equal(r('500 g flour', 1, 'us'), '1.1 lb flour'); assert.equal(r('250 ml water', 1, 'us'), '1.06 cup water', 'exact conversion (250 ml is 1.06 US cups), not "kitchen rounded"'); assert.equal(r('2 tbsp oil', 1, 'metric'), '30 ml oil'); assert.equal(r('1 tsp salt', 1, 'metric'), '5 ml salt');
  assert.equal(r('2 cups flour, sifted', 1, 'metric'), '475 ml flour, sifted'); assert.equal(r('4 cups water', 1, 'metric'), '945 ml water'); assert.equal(r('5 cups water', 1, 'metric'), '1.18 l water'); assert.equal(r('2 eggs', 1, 'metric'), '2 eggs');
  assert.equal(r('1 cup milk', 0, 'original'), '0 cup milk');
});
test('ingredientKey: merges plurals, keeps odd words', () => {
  for (const [a, b] of [['eggs', 'egg'], ['Tomatoes', 'tomato'], ['cloves garlic', 'cloves garlic'], ['berries', 'berry'], ['red onions', 'red onion'], ['peaches', 'peach'], ['boxes', 'box']]) assert.equal(ingredientKey(a), b, a);
  for (const w of ['molasses', 'hummus', 'asparagus', 'couscous', 'swiss cheese']) assert.equal(ingredientKey(w), w, w); assert.equal(ingredientKey('  Olive   OIL '), 'olive oil'); assert.equal(ingredientKey(''), '');
});
test('aggregate: sums across units of the same dimension, keeps dimensions apart, handles ranges and no-quantity lines', () => {
  const items = ['1 cup flour', '250 ml flour', '2 eggs', '1 egg', '500 g flour', '2-3 tomatoes', '1 tomato', 'salt to taste', 'Salt, to taste', '1 tbsp olive oil', '2 tsp olive oil'].map((l) => { const p = P(l); return { name: p.name, qty: p.qty, unit: p.unit }; });
  const out = aggregate(items, 'metric'); const by = Object.fromEntries(out.map((x) => [x.key, x]));
  assert.equal(by['flour|volume'].qtyText, '485 ml'); assert.equal(by['flour|weight'].qtyText, '500 g', 'volume and weight of "flour" are different lines (no density conversion)'); assert.equal(by['egg|count'].qtyText, '3'); assert.equal(by['tomato|count'].qtyText, '3–4');
  assert.equal(by['olive oil|volume'].qtyText, '25 ml'); assert.equal(out.filter((x) => x.dim === 'none').length, 2, 'untagged "salt" lines are not merged with measured ones (and "salt to taste" ≠ "Salt")');
  assert.equal(aggregate(items, 'us').find((x) => x.key === 'flour|volume').qtyText, '2.06 cup', '1 cup + 250 ml = 486.6 ml ≈ 2.06 US cups');
  assert.deepEqual(aggregate([], 'metric'), []);
});
