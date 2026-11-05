import test from 'node:test';
import assert from 'node:assert/strict';
import { score, keyboard, dayIndex } from '../src/game.js';
import { ANSWERS, EXTRA } from '../src/words.js';

test('score: basic cases', () => {
  assert.equal(score('crane', 'crane'), 'ggggg'); assert.equal(score('about', 'zzzzz'), 'xxxxx'); assert.equal(score('slate', 'crane'), 'xxgxg');
  assert.equal(score('speed', 'abide'), 'xxyxy', 'only one E in the answer: the first E is yellow, the second gets nothing');
});
test('score: repeated letters never over-count', () => {
  assert.equal(score('allee', 'apple'), 'gyxxg'); assert.equal(score('geese', 'those'), 'xxxgg'); assert.equal(score('llama', 'hello'), 'yyxxx'); assert.equal(score('eerie', 'there'), 'yxyxg');
  assert.equal(score('aaaaa', 'abcde'), 'gxxxx'); assert.equal(score('bbbbb', 'abcde'), 'xgxxx'); assert.equal(score('abbey', 'babes'), 'yyggx'); assert.equal(score('mamma', 'ahead'), 'xyxxy');
});
test('score: green takes priority over an earlier same-letter yellow', () => {
  assert.equal(score('tooth', 'robot'), 'ygyxx'); assert.equal(score('xaaxx', 'zzzaz'), 'xyxxx'); assert.equal(score('aabbb', 'zazzz'), 'xgxxx');
});
test('keyboard keeps the best state per letter', () => {
  const k = keyboard([{ guess: 'crane', result: 'xyxxg' }, { guess: 'react', result: 'ygxxx' }, { guess: 'cargo', result: 'gxyxx' }]);
  assert.deepEqual(k, { c: 'g', r: 'y', a: 'x', n: 'x', e: 'g', t: 'x', g: 'x', o: 'x' });
});
test('dayIndex', () => { assert.equal(dayIndex('2026-01-01'), 0); assert.equal(dayIndex('2026-03-11'), 69); assert.equal(dayIndex('2025-12-31'), -1); });
test('word lists are clean and disjoint', () => {
  for (const w of [...ANSWERS, ...EXTRA]) assert.match(w, /^[a-z]{5}$/, w); assert.equal(new Set(ANSWERS).size, ANSWERS.length); assert.ok(ANSWERS.length > 400); assert.equal(EXTRA.filter((w) => ANSWERS.includes(w)).length, 0);
});
