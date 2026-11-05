import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { PASSAGES } from '../src/passages.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ now: () => new Date('2026-03-10T12:00:00Z') }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const easy = PASSAGES.find((p) => p.level === 'easy'), hard = PASSAGES.find((p) => p.level === 'hard'), len = (p) => [...p.text].length;
const res = (p, o = {}) => ({ passageId: p.id, durationMs: 60000, typedChars: len(p), correctChars: len(p) - 2, keystrokes: len(p) + 4, wrongKeystrokes: 6, mistakes: { e: 4, t: 2 }, ...o });

test('passages: list and filter by level', async () => { const all = await (await call('GET', '/passages')).json(); assert.equal(all.length, PASSAGES.length); assert.ok((await (await call('GET', '/passages?level=hard')).json()).every((p) => p.level === 'hard')); });
test('results: server computes stats (client-claimed numbers ignored); personal best detection; history', async () => {
  const a = await (await call('POST', '/results', { ...res(easy), wpm: 500, accuracy: 100 })).json(); const expected = Math.round((((len(easy) - 2) / 5) / 1) * 10) / 10;
  assert.equal(a.wpm, expected); assert.equal(a.level, 'easy'); assert.equal(a.personalBest, true); assert.equal(a.previousBest, null); assert.equal(a.day, '2026-03-10');
  const slower = await (await call('POST', '/results', res(easy, { durationMs: 90000 }))).json(); assert.equal(slower.personalBest, false); assert.equal(slower.previousBest, expected);
  const faster = await (await call('POST', '/results', res(easy, { durationMs: 40000 }))).json(); assert.equal(faster.personalBest, true);
  assert.equal((await (await call('GET', '/results')).json())[0].id, faster.id); assert.deepEqual(faster.mistakes, { e: 4, t: 2 });
});
test('results: validation (unknown passage, impossible speed, inconsistent numbers)', async () => {
  assert.equal((await call('POST', '/results', { ...res(easy), passageId: 'nope' })).status, 422);
  const fast = await call('POST', '/results', res(easy, { durationMs: 2000 })); assert.equal(fast.status, 422); assert.match((await fast.json()).details.durationMs, /not humanly possible/);
  for (const [o, key] of [[{ correctChars: 999 }, 'correctChars'], [{ typedChars: 9999 }, 'typedChars'], [{ mistakes: { ab: 1 } }, 'mistakes'], [{ keystrokes: 'x' }, 'keystrokes']]) { const r = await call('POST', '/results', res(easy, o)); assert.equal(r.status, 422); assert.ok((await r.json()).details[key], key); }
  assert.equal((await fetch(base + '/api/results', { method: 'POST', body: '{x' })).status, 400);
});
test('stats: bests per level, averages of the last 10, weak keys, streak, trend', async () => {
  await call('POST', '/results', res(hard, { durationMs: 120000, mistakes: { '#': 9 } })); await call('POST', '/results?today=2026-03-09', res(easy));
  const s = await (await call('GET', '/stats')).json(); assert.ok(s.total >= 4); assert.ok(s.best.easy.wpm > 0 && s.best.hard.wpm > 0 && !s.best.medium); assert.deepEqual(s.weakKeys.slice(0, 2), [{ ch: 'e', count: 16 }, { ch: '#', count: 9 }], 'aggregated over the last 50 results: 4 easy runs × 4 "e" mistakes vs one hard run'); assert.equal(s.streak >= 1, true); assert.ok(s.trend.length >= 4 && s.trend.length <= 20); assert.ok(s.averageWpm > 0 && s.averageAccuracy > 0 && s.averageAccuracy <= 100);
  assert.equal((await (await call('GET', '/stats?today=2026-03-11')).json()).streak, 2, 'client date within ±1 day of UTC is honoured; 03-11 is empty (grace day) and 03-10 + 03-09 had results'); assert.equal((await (await call('GET', '/stats?today=2030-01-01')).json()).streak >= 1, true, 'far-off dates are ignored');
});
test('delete one / all results; errors and static', async () => {
  const r = await (await call('POST', '/results', res(easy))).json(); assert.equal((await call('DELETE', `/results/${r.id}`)).status, 204); assert.equal((await call('DELETE', `/results/${r.id}`)).status, 404); assert.equal((await call('DELETE', '/results')).status, 204); assert.equal((await (await call('GET', '/results')).json()).length, 0); assert.equal((await (await call('GET', '/stats')).json()).total, 0);
  const m = await fetch(base + '/typing.js'); assert.equal(m.status, 200); assert.match(await m.text(), /export function analyze/); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.equal((await call('GET', '/nope')).status, 404);
});
