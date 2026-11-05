import test from 'node:test';
import assert from 'node:assert/strict';
import { roundRobin, seedOrder, nextPow2, bracket, roundCount, standings } from '../src/tournament.js';

test('roundRobin: everyone meets everyone exactly once, nobody plays twice per round', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const rounds = roundRobin(n); assert.equal(rounds.length, n % 2 ? n : n - 1, `rounds for ${n}`); const seen = new Set();
    for (const r of rounds) { const inRound = new Set(); for (const [a, b] of r) { assert.notEqual(a, b); assert.ok(!inRound.has(a) && !inRound.has(b), `player twice in a round (n=${n})`); inRound.add(a); inRound.add(b); const key = [a, b].sort().join('-'); assert.ok(!seen.has(key), `repeat ${key}`); seen.add(key); } assert.equal(r.length, Math.floor(n / 2)); }
    assert.equal(seen.size, (n * (n - 1)) / 2);
  }
  assert.deepEqual(roundRobin(1), []); assert.deepEqual(roundRobin(0), []);
});
test('roundRobin: each player gets exactly one bye when n is odd, none when even', () => {
  const count = (n) => { const byes = Array(n).fill(0); for (const r of roundRobin(n)) { const playing = new Set(r.flat()); for (let i = 0; i < n; i++) if (!playing.has(i)) byes[i]++; } return byes; };
  assert.deepEqual(count(5), [1, 1, 1, 1, 1]); assert.deepEqual(count(4), [0, 0, 0, 0]);
});
test('seedOrder: top seeds are kept apart until late', () => {
  assert.deepEqual(seedOrder(2), [1, 2]); assert.deepEqual(seedOrder(4), [1, 4, 2, 3]); assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]); assert.equal(seedOrder(16).length, 16);
  for (const size of [4, 8, 16, 32]) { const o = seedOrder(size); assert.deepEqual([...o].sort((a, b) => a - b), [...Array(size).keys()].map((i) => i + 1)); for (let i = 0; i < size; i += 2) assert.equal(o[i] + o[i + 1], size + 1, 'each first-round pair sums to size+1'); const half = size / 2; assert.ok(o.indexOf(1) < half && o.indexOf(2) >= half, '1 and 2 are in opposite halves'); }
});
test('nextPow2 / roundCount', () => { assert.deepEqual([1, 2, 3, 4, 5, 8, 9].map(nextPow2), [1, 2, 4, 4, 8, 8, 16]); assert.deepEqual([0, 1, 2, 3, 4, 5, 8, 9, 16].map(roundCount), [0, 0, 1, 2, 2, 3, 3, 4, 4]); });
test('bracket: byes go to the top seeds; 8 players; 5 players; 2 players', () => {
  const b8 = bracket(8); assert.equal(b8.rounds.length, 3); assert.deepEqual(b8.rounds[0].map((m) => m.slot), [[1, 8], [4, 5], [2, 7], [3, 6]]); assert.deepEqual(b8.rounds.map((r) => r.length), [4, 2, 1]);
  const b5 = bracket(5); assert.equal(b5.size, 8); assert.deepEqual(b5.rounds[0].map((m) => m.slot), [[1, null], [4, 5], [2, null], [3, null]], 'seeds 1,2,3 get byes'); assert.equal(b5.rounds[0].flatMap((m) => m.slot).filter((s) => s === null).length, 3);
  const b2 = bracket(2); assert.deepEqual(b2.rounds, [[{ slot: [1, 2] }]]); assert.deepEqual(bracket(1), { size: 1, rounds: [] });
  const b6 = bracket(6); assert.deepEqual(b6.rounds[0].map((m) => m.slot), [[1, null], [4, 5], [2, null], [3, 6]]);
});
const g = (a, b, sa, sb) => ({ a, b, sa, sb });
test('standings: points, W/D/L, goals; equal points → goal difference when head-to-head is level', () => {
  const s = standings(3, [g(0, 1, 2, 0), g(0, 2, 1, 1), g(1, 2, 0, 3)]);
  assert.deepEqual(s.map((r) => r.i), [2, 0, 1], '0 and 2 both have 4 points and drew each other → goal difference (+3 vs +2)');
  assert.deepEqual(s[0], { i: 2, played: 2, won: 1, drawn: 1, lost: 0, gf: 4, ga: 1, gd: 3, points: 4, rank: 1 }); assert.deepEqual(s[2], { i: 1, played: 2, won: 0, drawn: 0, lost: 2, gf: 0, ga: 5, gd: -5, points: 0, rank: 3 });
});
test('standings: head-to-head among tied teams outranks goal difference', () => {
  // A and B both finish on 6 points; B has a far better goal difference but A beat B.
  const s = standings(4, [g(0, 1, 1, 0), g(0, 2, 1, 0), g(0, 3, 0, 5), g(1, 2, 6, 0), g(1, 3, 6, 0), g(2, 3, 1, 0)]);
  assert.deepEqual(s.map((r) => [r.i, r.points]), [[0, 6], [1, 6], [2, 3], [3, 3]]); assert.ok(s[1].gd > s[0].gd, 'B really does have the better goal difference'); assert.deepEqual(s.map((r) => r.rank), [1, 2, 3, 4]);
});
test('standings: configurable points, no games, and scores must be counted once', () => {
  assert.deepEqual(standings(2, []).map((r) => [r.i, r.points, r.rank]), [[0, 0, 1], [1, 0, 2]]);
  const s = standings(2, [g(0, 1, 3, 3)], { win: 2, draw: 1 }); assert.deepEqual(s.map((r) => r.points), [1, 1]); assert.equal(standings(2, [g(0, 1, 1, 0)], { win: 2 })[0].points, 2);
  assert.equal(standings(3, [g(1, 2, 4, 1)]).find((r) => r.i === 0).played, 0);
});
