import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePoll, isClosed, canSeeResults, tally, validateChoice, createLimiter, newToken, hashToken, tokenMatches, isToken } from '../src/poll.js';

const NOW = Date.parse('2026-03-10T12:00:00Z');
test('tokens: unguessable, URL-safe, hashed comparison', () => {
  const a = newToken(), b = newToken(); assert.notEqual(a, b); assert.ok(isToken(a) && a.length >= 20); assert.equal(hashToken(a).length, 64); assert.ok(tokenMatches(a, hashToken(a))); assert.ok(!tokenMatches(b, hashToken(a)));
  for (const bad of ['', 'short', 'a'.repeat(65), 'has space 123456789012', null, '../etc/passwd/..........']) assert.equal(isToken(bad), false, String(bad));
});
test('validatePoll: accepts good input, trims, drops blank options, reports every problem', () => {
  const r = validatePoll({ question: ' Lunch? ', options: [' Pizza ', '', 'Sushi'], multi: 1, closesAt: '2026-03-11T00:00:00Z' }, NOW); assert.deepEqual(r.value, { question: 'Lunch?', options: ['Pizza', 'Sushi'], multi: true, resultsMode: 'always', closesAt: '2026-03-11T00:00:00.000Z' });
  const bad = validatePoll({ question: '', options: ['a'], resultsMode: 'x', closesAt: 'soon' }, NOW); assert.deepEqual(Object.keys(bad.errors).sort(), ['closesAt', 'options', 'question', 'resultsMode']);
  for (const [o, re] of [[['a', 'A'], /different/], [Array(11).fill(0).map((_, i) => 'o' + i), /At most 10/], [['a', 'x'.repeat(101)], /≤ 100/]]) assert.match(validatePoll({ question: 'q', options: o }, NOW).errors.options, re);
  assert.match(validatePoll({ question: 'q', options: ['a', 'b'], closesAt: '2026-03-10T11:00:00Z' }, NOW).errors.closesAt, /future/); assert.match(validatePoll({ question: 'q', options: ['a', 'b'], closesAt: '2030-01-01T00:00:00Z' }, NOW).errors.closesAt, /within 365 days/); assert.ok(validatePoll(null, NOW).errors.question);
});
test('isClosed: manual flag or deadline', () => { assert.equal(isClosed({ closed: 0, closesAt: null }, NOW), false); assert.equal(isClosed({ closed: 1 }, NOW), true); assert.equal(isClosed({ closed: 0, closesAt: '2026-03-10T12:00:00.000Z' }, NOW), true, 'deadline reached'); assert.equal(isClosed({ closed: 0, closesAt: '2026-03-10T12:00:01.000Z' }, NOW), false); });
test('results visibility policy', () => {
  const v = (mode, o) => canSeeResults(mode, { hasVoted: false, closed: false, isAdmin: false, ...o });
  assert.equal(v('always', {}), true); assert.equal(v('after_vote', {}), false); assert.equal(v('after_vote', { hasVoted: true }), true); assert.equal(v('after_vote', { closed: true }), true);
  assert.equal(v('after_close', { hasVoted: true }), false); assert.equal(v('after_close', { closed: true }), true); assert.equal(v('after_close', { isAdmin: true }), true);
});
test('tally and validateChoice', () => {
  assert.deepEqual(tally([1, 2, 3], [1, 1, 3, 99]), { 1: 2, 2: 0, 3: 1 });
  const single = { optionIds: [1, 2, 3], multi: false }, multi = { optionIds: [1, 2, 3], multi: true };
  assert.deepEqual(validateChoice(single, [2]), { ids: [2] }); assert.equal(validateChoice(single, [1, 2]).error, 'Choose exactly one option'); assert.deepEqual(validateChoice(multi, [3, 1, 3]), { ids: [3, 1] });
  for (const bad of [[], [9], ['1'], null, 'x', [1.5]]) assert.ok(validateChoice(multi, bad).error, JSON.stringify(bad));
});
test('rate limiter: fixed window, per key, retry-after, resets', () => {
  let t = 1000; const lim = createLimiter(3, 60000, () => t);
  for (let i = 0; i < 3; i++) assert.equal(lim('a').ok, true); const blocked = lim('a'); assert.equal(blocked.ok, false); assert.equal(blocked.retryAfter, 60); assert.equal(lim('b').ok, true, 'other key unaffected');
  t += 30000; assert.equal(lim('a').retryAfter, 30); t += 30000; assert.equal(lim('a').ok, true, 'window reset');
});
