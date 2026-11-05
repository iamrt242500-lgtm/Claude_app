import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, renameLinks, validateNote, toFtsQuery } from '../src/links.js';

test('extractLinks: unique, lowercase, trimmed, ignores code', () => {
  assert.deepEqual(extractLinks('See [[Alpha]] and [[ alpha ]] and [[Beta|label]].'), ['alpha', 'beta']);
  assert.deepEqual(extractLinks('`[[InCode]]` and\n```\n[[Fenced]]\n```\nreal [[Real]]'), ['real']);
  assert.deepEqual(extractLinks('[[]] [[a|b|c]] [x](y) [[ok'), ['a'], 'a | inside the label is allowed');
  assert.deepEqual(extractLinks('[[]] [x](y) [[ok'), []);
});
test('renameLinks keeps labels, case-insensitive, skips code', () => {
  assert.equal(renameLinks('[[Old]] [[old|shown]] [[OLD ]] [[Other]] `[[Old]]`', 'Old', 'New Name'), '[[New Name]] [[New Name|shown]] [[New Name]] [[Other]] `[[Old]]`');
});
test('validateNote', () => {
  assert.deepEqual(validateNote({ title: '  My   note ', body: 'x\u0001' }).value, { title: 'My note', body: 'x' });
  for (const [t, re] of [['', /required/], ['a[b', /cannot contain/], ['a|b', /cannot contain/], ['x'.repeat(101), /≤ 100/]]) assert.match(validateNote({ title: t }).errors.title, re);
  assert.ok(validateNote({ title: 't', body: 'x'.repeat(100001) }).errors.body); assert.ok(validateNote(null).errors);
});
test('toFtsQuery', () => { assert.equal(toFtsQuery('a "b" *'), '"a"* "b"*'); assert.equal(toFtsQuery('***'), null); });
