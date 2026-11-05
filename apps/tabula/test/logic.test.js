import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, detectDelimiter } from '../src/csv.js';
import { inferType, profileColumn, uniqueHeaders, aggregate } from '../src/profile.js';

test('csv: quotes, escaped quotes, embedded newline, CRLF, BOM', () => {
  const { rows } = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",3\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"'], ['line1\nline2', '3']]);
});
test('csv: delimiter detection, blank lines, trailing row without newline, quoted empty row kept', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';'); assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.deepEqual(parseCsv('a,b\n\n1,2').rows, [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a\n""').rows, [['a'], ['']]);
});
test('csv: unterminated quote throws', () => assert.throws(() => parseCsv('a,b\n"oops,1'), /Unterminated/));
test('inferType', () => {
  assert.equal(inferType(['1', '2.5', '1,200', '']), 'number'); assert.equal(inferType(['Yes', 'no']), 'boolean');
  assert.equal(inferType(['2026-01-02', '2026-02-03 10:00']), 'date'); assert.equal(inferType(['1', 'x']), 'text');
  assert.equal(inferType(['', 'NA', 'null']), 'empty'); assert.equal(inferType(['2026-13-45']), 'text');
});
test('profileColumn numeric stats and histogram', () => {
  const p = profileColumn('n', ['1', '2', '3', '4', '', '100']);
  assert.equal(p.nulls, 1); assert.equal(p.min, 1); assert.equal(p.max, 100); assert.equal(p.median, 3); assert.equal(p.mean, 22); assert.equal(p.sum, 110);
  assert.equal(p.hist.reduce((s, b) => s + b.count, 0), 5); assert.equal(p.hist[0].count, 4);
});
test('profileColumn constant column does not divide by zero', () => {
  const p = profileColumn('c', ['5', '5', '5']); assert.equal(p.std, 0); assert.equal(p.hist[0].count, 3);
});
test('uniqueHeaders', () => assert.deepEqual(uniqueHeaders(['a', 'a', '', ' a ']), ['a', 'a_2', 'column_3', 'a_3']));
test('aggregate', () => {
  const cols = [{ name: 'g', type: 'text' }, { name: 'v', type: 'number' }];
  const rows = [{ g: 'a', v: '1' }, { g: 'a', v: '3' }, { g: 'b', v: '10' }, { g: '', v: '' }];
  assert.deepEqual(aggregate(rows, cols, { group: 'g', metric: 'v', fn: 'sum' }).map((x) => [x.key, x.value]), [['b', 10], ['a', 4], ['(empty)', 0]]);
  assert.equal(aggregate(rows, cols, { group: 'g', fn: 'count' })[0].value, 2);
  assert.equal(aggregate(rows, cols, { group: 'g', metric: 'v', fn: 'avg' }).find((x) => x.key === 'a').value, 2);
  assert.throws(() => aggregate(rows, cols, { group: 'nope', fn: 'count' }), RangeError);
  assert.throws(() => aggregate(rows, cols, { group: 'g', metric: 'g', fn: 'sum' }), RangeError);
});
