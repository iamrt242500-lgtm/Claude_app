import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFrom, rng, shuffle, parseEntries, drawWinners, makeGroups, secretSanta, randInt } from '../src/draw.js';

test('seedFrom / rng are deterministic and well spread', () => {
  assert.equal(seedFrom('hello'), seedFrom('hello')); assert.notEqual(seedFrom('hello'), seedFrom('hellp')); const a = rng(42), b = rng(42); assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const r = rng(7), xs = Array.from({ length: 20000 }, r); assert.ok(xs.every((x) => x >= 0 && x < 1)); const mean = xs.reduce((s, x) => s + x, 0) / xs.length; assert.ok(Math.abs(mean - 0.5) < 0.01, String(mean));
});
test('shuffle keeps the elements, is reproducible and (statistically) uniform', () => {
  const items = [1, 2, 3, 4, 5]; assert.deepEqual([...shuffle(items, rng(3))].sort(), items); assert.deepEqual(shuffle(items, rng(3)), shuffle(items, rng(3))); assert.deepEqual(items, [1, 2, 3, 4, 5], 'input untouched');
  const r = rng(99), counts = {}; for (let i = 0; i < 60000; i++) { const k = shuffle([0, 1, 2], r).join(''); counts[k] = (counts[k] || 0) + 1; } assert.equal(Object.keys(counts).length, 6); for (const n of Object.values(counts)) assert.ok(Math.abs(n - 10000) < 400, JSON.stringify(counts));
  assert.ok(Array.from({ length: 1000 }, () => randInt(r, 10)).every((n) => n >= 0 && n < 10));
});
test('parseEntries: weights, merging, limits, errors', () => {
  const p = parseEntries('Ann\nBob x3\n  cy*2  \n\nANN\nDi × 5'); assert.deepEqual(p.entries, [{ name: 'Ann', weight: 2 }, { name: 'Bob', weight: 3 }, { name: 'cy', weight: 2 }, { name: 'Di', weight: 5 }]); assert.deepEqual(p.errors, []);
  assert.deepEqual(parseEntries('* 3').errors, ['Line 1: name is empty']); assert.deepEqual(parseEntries('x2').entries, [{ name: 'x2', weight: 1 }], 'an x glued to the name is part of the name'); assert.match(parseEntries('Ann x0').errors[0], /weight must be 1–1000/); assert.match(parseEntries('Ann x5000').errors[0], /weight/); assert.match(parseEntries('a'.repeat(61)).errors[0], /longer than 60/);
  assert.deepEqual(parseEntries('').entries, []); assert.deepEqual(parseEntries(null).entries, []); assert.deepEqual(parseEntries('Box 2').entries, [{ name: 'Box 2', weight: 1 }], 'a trailing number without x is part of the name'); assert.deepEqual(parseEntries('Max').entries, [{ name: 'Max', weight: 1 }], 'names ending in x are not weights');
});
test('drawWinners: distinct, capped by the pool, reproducible', () => {
  const e = parseEntries('A\nB\nC\nD').entries; const w = drawWinners(e, 3, rng(5)); assert.equal(new Set(w).size, 3); assert.deepEqual(w, drawWinners(e, 3, rng(5))); assert.equal(drawWinners(e, 10, rng(5)).length, 4); assert.deepEqual(drawWinners([], 2, rng(1)), []);
});
test('drawWinners honours weights (first-place frequency ≈ weight share)', () => {
  const e = [{ name: 'heavy', weight: 8 }, { name: 'light', weight: 2 }], r = rng(2026); let heavy = 0; const N = 20000; for (let i = 0; i < N; i++) if (drawWinners(e, 1, r)[0] === 'heavy') heavy++; assert.ok(Math.abs(heavy / N - 0.8) < 0.015, String(heavy / N));
  const e2 = [{ name: 'a', weight: 1 }, { name: 'b', weight: 1 }, { name: 'c', weight: 1 }]; let second = { a: 0, b: 0, c: 0 }; for (let i = 0; i < 30000; i++) second[drawWinners(e2, 2, r)[1]]++; for (const n of Object.values(second)) assert.ok(Math.abs(n - 10000) < 400, JSON.stringify(second));
});
test('makeGroups: sizes differ by at most one, nobody lost or duplicated', () => {
  for (const [n, g] of [[10, 3], [9, 3], [2, 5], [1, 1], [13, 4]]) { const names = Array.from({ length: n }, (_, i) => 'p' + i), gs = makeGroups(names, g, rng(n * g)); assert.equal(gs.length, g); assert.deepEqual(gs.flat().sort(), [...names].sort()); const sizes = gs.map((x) => x.length); assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${n}/${g}: ${sizes}`); }
});
test('secretSanta: nobody gets themselves, everyone gives and receives once; ring is one cycle', () => {
  for (const ring of [true, false]) for (let seed = 1; seed <= 200; seed++) { const names = ['A', 'B', 'C', 'D', 'E'], m = secretSanta(names, rng(seed), { ring }); assert.ok(m); assert.deepEqual(Object.keys(m).sort(), names); assert.deepEqual(Object.values(m).sort(), names); assert.ok(names.every((n) => m[n] !== n)); if (ring) { let cur = 'A', steps = 0; do { cur = m[cur]; steps++; } while (cur !== 'A'); assert.equal(steps, 5, 'single cycle'); } }
  assert.equal(secretSanta(['A'], rng(1)), null); const two = secretSanta(['A', 'B'], rng(1), { ring: false }); assert.deepEqual(two, { A: 'B', B: 'A' });
});
