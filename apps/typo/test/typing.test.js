import test from 'node:test';
import assert from 'node:assert/strict';
import { charStates, analyze, mistakeMap, validateResult, weakKeys, dayStreak, LIMITS } from '../src/typing.js';
import { PASSAGES, LEVELS } from '../src/passages.js';

test('charStates marks ok / bad / pending', () => { assert.deepEqual(charStates('cat', 'cx'), ['ok', 'bad', 'pending']); assert.deepEqual(charStates('ab', ''), ['pending', 'pending']); assert.deepEqual(charStates('ab', 'abc'), ['ok', 'ok']); assert.deepEqual(charStates('héllo', 'hé'), ['ok', 'ok', 'pending', 'pending', 'pending']); });
test('analyze: WPM uses 5 chars per word and counts only correct characters', () => {
  const t = 'x'.repeat(50);
  let a = analyze(t, t, 30000); assert.equal(a.wpm, 20); assert.equal(a.rawWpm, 20); assert.equal(a.accuracy, 100); assert.equal(a.complete, true);   // 50 chars = 10 words in 0.5 min
  a = analyze(t, 'x'.repeat(40) + 'y'.repeat(10), 60000); assert.equal(a.correct, 40); assert.equal(a.wpm, 8); assert.equal(a.rawWpm, 10); assert.equal(a.uncorrected, 10); assert.equal(a.complete, false); assert.equal(a.accuracy, 80);
  assert.equal(analyze(t, '', 1000).wpm, 0); assert.equal(analyze(t, 'xx', 0).wpm, 0, 'zero elapsed time never divides by zero'); assert.equal(analyze('', '', 0).accuracy, 100);
});
test('analyze: accuracy counts corrected mistakes too (keystroke-level)', () => {
  const a = analyze('hello', 'hello', 10000, { keystrokes: 8, wrongKeystrokes: 3 }); assert.equal(a.accuracy, 62.5); assert.equal(a.complete, true, 'final text is perfect even though 3 keystrokes were wrong');
  assert.equal(analyze('héllo wörld', 'héllo wörld', 12000).correct, 11, 'astral/accented characters counted per code point');
});
test('mistakeMap and weakKeys', () => {
  const m = mistakeMap([{ expected: 'e', ok: false }, { expected: 'e', ok: false }, { expected: ' ', ok: false }, { expected: 'a', ok: true }]); assert.deepEqual(m, { e: 2, ' ': 1 });
  assert.deepEqual(weakKeys([{ mistakes: { e: 2, t: 1 } }, { mistakes: { e: 1, q: 5 } }, {}], 2), [{ ch: 'q', count: 5 }, { ch: 'e', count: 3 }]); assert.deepEqual(weakKeys([]), []);
});
const p = { id: 't', text: 'x'.repeat(100) };
const ok = { durationMs: 30000, typedChars: 100, correctChars: 95, keystrokes: 110, wrongKeystrokes: 15, mistakes: { x: 3 } };
test('validateResult accepts plausible results and derives stats server-side (client cannot claim a WPM)', () => {
  const r = validateResult({ ...ok, wpm: 999, accuracy: 100 }, p); assert.equal(r.value.wpm, 38); assert.equal(r.value.rawWpm, 40); assert.equal(r.value.accuracy, 86.4); assert.equal(r.value.wpm === 999, false); assert.deepEqual(r.value.mistakes, { x: 3 });
});
test('validateResult rejects impossible, inconsistent and malformed results', () => {
  const bad = (o, key) => { const r = validateResult({ ...ok, ...o }, p); assert.ok(r.errors?.[key], `${key} for ${JSON.stringify(o)}`); };
  bad({ durationMs: 3000 }, 'durationMs'); bad({ durationMs: 1 }, 'durationMs'); bad({ typedChars: 101 }, 'typedChars'); bad({ correctChars: 101 }, 'correctChars'); bad({ wrongKeystrokes: 111 }, 'wrongKeystrokes'); bad({ keystrokes: 50 }, 'keystrokes');
  bad({ durationMs: 0 }, 'durationMs'); bad({ durationMs: 1.5 }, 'durationMs'); bad({ typedChars: '100' }, 'typedChars'); bad({ mistakes: [] }, 'mistakes'); bad({ mistakes: { ab: 1 } }, 'mistakes'); bad({ mistakes: { a: 0 } }, 'mistakes'); bad({ durationMs: LIMITS.maxMs + 1 }, 'durationMs');
  assert.ok(validateResult(null, p).errors.durationMs);
  assert.equal(validateResult({ ...ok, durationMs: 7000 }, p).errors?.durationMs, undefined, '110 keystrokes in 7 s (~943 cpm ≈ 188 wpm) is allowed; 3 s is not');
});
test('dayStreak and the built-in passages', () => {
  assert.equal(dayStreak(['2026-03-08', '2026-03-09', '2026-03-10'], '2026-03-10'), 3); assert.equal(dayStreak(['2026-03-08', '2026-03-09'], '2026-03-10'), 2); assert.equal(dayStreak(['2026-03-07'], '2026-03-10'), 0);
  assert.deepEqual([...new Set(PASSAGES.map((x) => x.level))].sort(), [...LEVELS].sort()); assert.equal(new Set(PASSAGES.map((x) => x.id)).size, PASSAGES.length); for (const x of PASSAGES) assert.ok([...x.text].length >= 60 && [...x.text].length <= LIMITS.maxChars && x.text === x.text.trim() && !/\s{2}|\n/.test(x.text), x.id);
});
