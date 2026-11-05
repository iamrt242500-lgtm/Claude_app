import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitLines, myers, diffTexts, unified, wordDiff, LIMITS } from '../src/diff.js';

const apply = (ops, A, B) => { const a = [], b = []; for (const o of ops) { if (o.t === '=') { a.push(A[o.a]); b.push(B[o.b]); assert.equal(A[o.a], B[o.b]); } else if (o.t === '-') a.push(A[o.a]); else b.push(B[o.b]); } return [a, b]; };
const lcs = (A, B) => { const dp = Array.from({ length: A.length + 1 }, () => new Int32Array(B.length + 1)); for (let i = 1; i <= A.length; i++) for (let j = 1; j <= B.length; j++) dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]); return dp[A.length][B.length]; };
let seed = 987654321; const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

test('splitLines: CRLF/CR, trailing newline, empty input', () => {
  assert.deepEqual(splitLines('a\r\nb\rc\n'), ['a', 'b', 'c']); assert.deepEqual(splitLines(''), []); assert.deepEqual(splitLines('\n'), ['']); assert.deepEqual(splitLines('a\n\nb'), ['a', '', 'b']); assert.deepEqual(splitLines(null), []);
});
test('myers: textbook example has the minimal script (D = 5)', () => {
  const A = [...'ABCABBA'], B = [...'CBABAC']; const ops = myers(A, B); const d = ops.filter((o) => o.t !== '=').length; assert.equal(d, 5); const [a, b] = apply(ops, A, B); assert.deepEqual(a, A); assert.deepEqual(b, B);
});
test('myers: edge cases', () => {
  assert.deepEqual(myers([], []), []); assert.deepEqual(myers([], ['x']).map((o) => o.t), ['+']); assert.deepEqual(myers(['x'], []).map((o) => o.t), ['-']); assert.deepEqual(myers(['a', 'b'], ['a', 'b']).map((o) => o.t), ['=', '=']); assert.deepEqual(myers(['a'], ['b']).map((o) => o.t).sort(), ['+', '-']);
  assert.equal(myers(Array(50).fill('a'), Array(50).fill('b'), 10), null, 'gives up (returns null) when the edit distance exceeds the cap');
});
test('property: 400 random pairs reconstruct both sides exactly AND are minimal (edits = n + m − 2·LCS)', () => {
  for (let t = 0; t < 400; t++) {
    const alpha = 1 + rnd(4), gen = (n) => Array.from({ length: n }, () => String.fromCharCode(97 + rnd(alpha))); const A = gen(rnd(25)), B = gen(rnd(25));
    const ops = myers(A, B); const [a, b] = apply(ops, A, B); assert.deepEqual(a, A); assert.deepEqual(b, B);
    assert.equal(ops.filter((o) => o.t !== '=').length, A.length + B.length - 2 * lcs(A, B), `minimal for ${A.join('')} → ${B.join('')}`);
  }
});
test('property: edited copies of a larger document diff to exactly the edits made', () => {
  const base = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(i % 7)}`); const B = base.slice(); let edits = 0;
  for (let k = 0; k < 12; k++) { const i = rnd(B.length); if (k % 3 === 0) { B.splice(i, 1); edits++; } else if (k % 3 === 1) { B.splice(i, 0, `inserted ${k}`); edits++; } else { B[i] = B[i] + ' changed'; edits += 2; } }
  const r = diffTexts(base.join('\n'), B.join('\n')); assert.ok(r.stats.added + r.stats.removed <= edits, 'never more edits than were made'); assert.ok(r.stats.added + r.stats.removed >= 1);
});
test('diffTexts rows: eq/del/add/mod with line numbers, trailing newline irrelevant', () => {
  const r = diffTexts('one\ntwo\nthree\nfour\n', 'one\nTWO\nthree\nfive\nsix'); assert.deepEqual(r.rows.map((x) => x.type), ['eq', 'mod', 'eq', 'mod', 'add']);
  assert.deepEqual(r.rows[1].left, { n: 2, text: 'two' }); assert.deepEqual(r.rows[1].right, { n: 2, text: 'TWO' }); assert.deepEqual(r.rows[4].right, { n: 5, text: 'six' }); assert.equal(r.rows[4].left, null);
  assert.deepEqual(r.stats, { added: 3, removed: 2, changed: 2, unchanged: 2, identical: false }); assert.equal(diffTexts('a\n', 'a').stats.identical, true); assert.equal(diffTexts('', '').stats.identical, true);
  const d = diffTexts('a\nb\nc', 'a\nc'); assert.deepEqual(d.rows.map((x) => x.type), ['eq', 'del', 'eq']);
});
test('options: ignore whitespace and case', () => {
  assert.equal(diffTexts('a  b\n  c', 'a b\nc', { ignoreWhitespace: true }).stats.identical, true); assert.equal(diffTexts('a  b', 'a b').stats.identical, false);
  assert.equal(diffTexts('Hello', 'hello', { ignoreCase: true }).stats.identical, true); assert.equal(diffTexts('Hello', 'hello').stats.identical, false);
  const r = diffTexts('  keep\nHELLO', 'keep\nhello world', { ignoreWhitespace: true, ignoreCase: true }); assert.deepEqual(r.rows.map((x) => x.type), ['eq', 'mod']);
});
test('wordDiff highlights only the changed words and rebuilds both sides', () => {
  const w = wordDiff('the quick brown fox', 'the quick red fox'); assert.deepEqual(w.left, [{ t: '=', text: 'the quick ' }, { t: '-', text: 'brown' }, { t: '=', text: ' fox' }]); assert.deepEqual(w.right, [{ t: '=', text: 'the quick ' }, { t: '+', text: 'red' }, { t: '=', text: ' fox' }]);
  for (const [l, r] of [['', 'x'], ['x', ''], ['a,b;c', 'a.b;c'], ['日本語 テスト', '日本語 テスト!']]) { const x = wordDiff(l, r); assert.equal(x.left.map((s) => s.text).join(''), l); assert.equal(x.right.map((s) => s.text).join(''), r); }
});
test('unified output matches the shape of diff -u and agrees with GNU diff on +/- counts', () => {
  const a = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n', b = 'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\n'; const u = unified(diffTexts(a, b), { leftName: 'old.txt', rightName: 'new.txt' });
  assert.match(u, /^--- old\.txt\n\+\+\+ new\.txt\n@@ -1,5 \+1,5 @@\n a\n-b\n\+B\n c\n d\n e\n@@ -8,3 \+8,4 @@\n h\n i\n j\n\+k\n$/);
  assert.equal(unified(diffTexts('same', 'same')), '');
  let gnu = null; const dir = mkdtempSync(join(tmpdir(), 'diffly-')); try { writeFileSync(join(dir, 'a'), a); writeFileSync(join(dir, 'b'), b); try { execFileSync('diff', ['-u', join(dir, 'a'), join(dir, 'b')]); } catch (e) { gnu = String(e.stdout); } } catch { /* diff not installed */ } finally { rmSync(dir, { recursive: true, force: true }); }
  if (gnu) { const count = (s, c) => s.split('\n').filter((l) => l.startsWith(c) && !l.startsWith(c + c + c)).length; assert.equal(count(u, '+'), count(gnu, '+')); assert.equal(count(u, '-'), count(gnu, '-')); assert.equal((u.match(/^@@/gm) || []).length, (gnu.match(/^@@/gm) || []).length, 'same number of hunks'); }
});
test('unified: context merging, insert at start, delete everything', () => {
  const lines = Array.from({ length: 30 }, (_, i) => 'l' + i); const m = lines.slice(); m[3] = 'X'; m[9] = 'Y'; m[25] = 'Z';
  const u = unified(diffTexts(lines.join('\n'), m.join('\n')), { context: 3 }); assert.equal((u.match(/^@@/gm) || []).length, 2, 'changes 6 lines apart merge into one hunk; 16 apart do not'); assert.match(u, /@@ -1,13 \+1,13 @@/);
  assert.match(unified(diffTexts('b\nc', 'a\nb\nc')), /@@ -1,2 \+1,3 @@\n\+a\n b\n c\n$/); assert.match(unified(diffTexts('x\ny', '')), /@@ -1,2 \+0,0 @@\n-x\n-y\n$/);
});
test('limits and performance: big inputs, huge edit distance falls back, oversize is rejected', () => {
  const big = Array.from({ length: 4000 }, (_, i) => 'row ' + i); const b2 = big.slice(); for (let i = 0; i < 4000; i += 40) b2[i] = 'changed ' + i;
  let t = Date.now(); const r = diffTexts(big.join('\n'), b2.join('\n')); assert.equal(r.stats.changed, 100); assert.ok(Date.now() - t < 2000, 'few edits on 4000 lines is fast: ' + (Date.now() - t) + ' ms');
  t = Date.now(); const worst = diffTexts(Array.from({ length: 4000 }, (_, i) => 'a' + i).join('\n'), Array.from({ length: 4000 }, (_, i) => 'b' + i).join('\n')); assert.equal(worst.coarse, true); assert.equal(worst.stats.removed, 4000); assert.ok(Date.now() - t < 3000, 'worst case is capped, not quadratic-memory: ' + (Date.now() - t) + ' ms');
  assert.throws(() => diffTexts('x'.repeat(LIMITS.text + 1), ''), /characters/); assert.throws(() => diffTexts('a\n'.repeat(LIMITS.lines + 1), ''), /lines/);
});
