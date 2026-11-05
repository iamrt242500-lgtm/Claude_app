import test from 'node:test';
import assert from 'node:assert/strict';
import { isBoard, conflicts, candidates, solve, generate, mulberry32, shuffle, CLUES } from '../src/sudoku.js';

const PUZZLE = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';   // the classic Wikipedia puzzle
const SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

test('isBoard', () => { assert.ok(isBoard(PUZZLE)); for (const bad of ['', PUZZLE.slice(1), PUZZLE.replace('5', '0'), PUZZLE + '.', null, 5]) assert.equal(isBoard(bad), false); });
test('solve: classic puzzle has exactly one solution and it is the known one', () => {
  const r = solve(PUZZLE, 2); assert.equal(r.count, 1); assert.equal(r.solution, SOLUTION);
});
test('solve: counts multiple solutions, caps at limit, rejects conflicting and empty-candidate boards', () => {
  assert.equal(solve('.'.repeat(81), 2).count, 2); assert.equal(solve('.'.repeat(81), 1).count, 1);
  assert.equal(solve('55' + '.'.repeat(79)).count, 0, 'duplicate in a row'); assert.equal(solve('1.......2' + '.'.repeat(72)).count > 0, true);
  const stuck = '12345678.' + '.'.repeat(8) + '9' + '.'.repeat(63); assert.equal(conflicts(stuck).length, 0); assert.equal(solve(stuck).count, 0, 'first row cannot take a 9 in its last cell: column 9 already has one');
  assert.equal(solve(SOLUTION, 2).count, 1, 'a full valid grid solves to itself');
});
test('conflicts: row, column, box; ignores empties', () => {
  const b = (cells) => { const a = Array(81).fill('.'); for (const [i, d] of cells) a[i] = d; return a.join(''); };
  assert.deepEqual(conflicts(b([[0, '5'], [8, '5']])), [0, 8]); assert.deepEqual(conflicts(b([[0, '5'], [72, '5']])), [0, 72]); assert.deepEqual(conflicts(b([[0, '5'], [20, '5']])), [0, 20]); assert.deepEqual(conflicts(b([[0, '5'], [30, '5']])), [], 'different row, column and box');
  assert.deepEqual(conflicts('.'.repeat(81)), []); assert.deepEqual(conflicts(SOLUTION), []); assert.deepEqual(conflicts(PUZZLE), []);
});
test('candidates', () => { assert.deepEqual(candidates(PUZZLE, 2), ['1', '2', '4']); assert.deepEqual(candidates(PUZZLE, 0), [], 'filled cell'); });
test('mulberry32 and shuffle are deterministic', () => { const a = mulberry32(42), b = mulberry32(42); assert.deepEqual([a(), a(), a()], [b(), b(), b()]); assert.deepEqual(shuffle([1, 2, 3, 4, 5], mulberry32(1)), shuffle([1, 2, 3, 4, 5], mulberry32(1))); assert.deepEqual([...shuffle([1, 2, 3, 4, 5], mulberry32(9))].sort(), [1, 2, 3, 4, 5]); });
test('generate: unique solution, valid, right clue count, deterministic, seeds differ', () => {
  for (const [seed, diff] of [[1, 'easy'], [2, 'medium'], [3, 'hard'], [20260311, 'medium']]) {
    const g = generate(seed, diff); assert.ok(isBoard(g.puzzle)); assert.equal(g.puzzle.split('').filter((c) => c !== '.').length, g.clues); assert.ok(g.clues >= CLUES[diff] && g.clues <= CLUES[diff] + 3, `${diff}: ${g.clues} clues`);
    assert.equal(solve(g.puzzle, 2).count, 1, `${diff}/${seed} must have a unique solution`); assert.equal(solve(g.puzzle, 2).solution, g.solution); assert.deepEqual(conflicts(g.solution), []); assert.ok(!g.solution.includes('.'));
    for (let i = 0; i < 81; i++) if (g.puzzle[i] !== '.') assert.equal(g.puzzle[i], g.solution[i]);
  }
  assert.deepEqual(generate(7, 'medium'), generate(7, 'medium')); assert.notEqual(generate(7, 'medium').puzzle, generate(8, 'medium').puzzle); assert.throws(() => generate(1, 'nightmare'), RangeError);
});
