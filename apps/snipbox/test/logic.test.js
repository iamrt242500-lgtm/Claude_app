import test from 'node:test';
import assert from 'node:assert/strict';
import { toFtsQuery, validateSnippet, normalizeTags, splitHighlight, clean } from '../src/logic.js';

test('toFtsQuery neutralizes FTS syntax and builds prefix AND query', () => {
  assert.equal(toFtsQuery('Array flat'), '"array"* "flat"*');
  assert.equal(toFtsQuery('foo" OR bar*'), '"foo"* "or"* "bar"*');
  assert.equal(toFtsQuery('NEAR(a b) -x ^y'), '"near"* "a"* "b"* "x"* "y"*');
  assert.equal(toFtsQuery('  ***  '), null); assert.equal(toFtsQuery(''), null); assert.equal(toFtsQuery(undefined), null);
  assert.equal(toFtsQuery('café 日本語'), '"café"* "日本語"*'); assert.equal(toFtsQuery('a b c d e f g h i j').split(' ').length, 8);
});
test('normalizeTags', () => {
  assert.deepEqual(normalizeTags(' JS, Node Js ,js,,'), ['js', 'node-js']); assert.equal(normalizeTags(Array.from({ length: 20 }, (_, i) => 't' + i)).length, 8);
  assert.deepEqual(normalizeTags(undefined), []);
});
test('validateSnippet: defaults, errors, cleaning', () => {
  const ok = validateSnippet({ title: ' Flatten ', code: 'x.flat()\n\n', language: ' JS ', tags: 'a,b' });
  assert.deepEqual(ok.value, { title: 'Flatten', code: 'x.flat()', notes: '', language: 'js', tags: ['a', 'b'] });
  assert.equal(validateSnippet({ title: 't', code: 'c' }).value.language, 'text');
  const bad = validateSnippet({ title: '', code: '   ', language: 'bad lang!' }); assert.ok(bad.errors.title && bad.errors.code && bad.errors.language);
  assert.ok(validateSnippet({ title: 'x'.repeat(121), code: 'c' }).errors.title); assert.ok(validateSnippet({ title: 't', code: 'x'.repeat(50001) }).errors.code);
  assert.ok(validateSnippet(null).errors);
  assert.equal(clean('a\u0001b\u0002c\td\ne'), 'abc\td\ne');
  assert.equal(validateSnippet({ title: 't\u0001', code: 'c\u0002' }).value.code, 'c');
});
test('splitHighlight', () => {
  assert.deepEqual(splitHighlight('use \u0001flat\u0002() to'), [{ text: 'use ', hit: false }, { text: 'flat', hit: true }, { text: '() to', hit: false }]);
  assert.deepEqual(splitHighlight('plain'), [{ text: 'plain', hit: false }]); assert.deepEqual(splitHighlight(''), []);
});
