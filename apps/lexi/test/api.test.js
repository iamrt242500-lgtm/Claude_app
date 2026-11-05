import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, answerFor, stats } from '../src/server.js';
import { dayIndex, score } from '../src/game.js';
import { ANSWERS } from '../src/words.js';

let base, server, clock = '2026-03-11T10:00:00Z';
before(async () => { server = createApp({ now: () => new Date(clock) }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
// a tiny cookie-jar "player"
const player = () => { let cookie = ''; const call = async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', cookie }, body: b === undefined ? undefined : JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r; }; return { call, get cookie() { return cookie; } }; };
const wrongWord = (day) => ANSWERS.find((w) => w !== answerFor(day));
const day = () => dayIndex(clock.slice(0, 10));

test('answerFor: deterministic, walks the whole list without repeats', () => {
  assert.equal(answerFor(5), answerFor(5)); const seen = new Set(Array.from({ length: ANSWERS.length }, (_, i) => answerFor(i))); assert.equal(seen.size, ANSWERS.length); assert.ok(ANSWERS.includes(answerFor(-3)));
});
test('today: fresh game sets an HttpOnly cookie and never leaks the answer', async () => {
  const p = player(), r = await p.call('GET', '/today'); const j = await r.json(); assert.equal(j.status, 'playing'); assert.deepEqual(j.rows, []); assert.equal(j.answer, null); assert.match(r.headers.get('set-cookie'), /pid=[a-f0-9]{32}; Path=\/; HttpOnly; SameSite=Lax/);
  assert.ok(!JSON.stringify(j).includes(answerFor(day())));
});
test('guess: scoring is server-side; validation errors; duplicate rejected', async () => {
  const p = player(), a = answerFor(day()); const w = wrongWord(day()); const r = await (await p.call('POST', '/guess', { guess: w.toUpperCase() })).json(); assert.equal(r.rows[0].guess, w); assert.equal(r.rows[0].result, score(w, a));
  for (const [g, msg] of [['abc', /5-letter/], ['abc12', /5-letter/], ['zzzzz', /word list/], [w, /already/], [12, /5-letter/]]) { const x = await p.call('POST', '/guess', { guess: g }); assert.equal(x.status, 422, String(g)); assert.match((await x.json()).details.guess, msg); }
  assert.equal((await (await p.call('GET', '/today')).json()).rows.length, 1, 'rejected guesses do not use up attempts');
});
test('win: status, finished game rejects further guesses, stats count it', async () => {
  const p = player(); await p.call('POST', '/guess', { guess: wrongWord(day()) }); const r = await (await p.call('POST', '/guess', { guess: answerFor(day()) })).json(); assert.equal(r.status, 'won'); assert.equal(r.rows[1].result, 'ggggg'); assert.equal(r.answer, null);
  assert.equal((await p.call('POST', '/guess', { guess: wrongWord(day()) })).status, 409); const s = await (await p.call('GET', '/stats')).json(); assert.deepEqual({ ...s }, { played: 1, won: 1, winRate: 100, currentStreak: 1, maxStreak: 1, distribution: [0, 1, 0, 0, 0, 0] });
});
test('loss after 6 wrong guesses reveals the answer', async () => {
  const p = player(), wrong = ANSWERS.filter((w) => w !== answerFor(day())).slice(0, 6); let r; for (const w of wrong) r = await (await p.call('POST', '/guess', { guess: w })).json();
  assert.equal(r.status, 'lost'); assert.equal(r.answer, answerFor(day())); const s = await (await p.call('GET', '/stats')).json(); assert.equal(s.played, 1); assert.equal(s.won, 0); assert.equal(s.currentStreak, 0);
});
test('players are isolated; a new day starts a fresh game and keeps the streak', async () => {
  const a = player(), b = player(); await a.call('POST', '/guess', { guess: wrongWord(day()) }); assert.equal((await (await b.call('GET', '/today')).json()).rows.length, 0);
  await a.call('POST', '/guess', { guess: answerFor(day()) }); clock = '2026-03-12T09:00:00Z'; const t = await (await a.call('GET', '/today')).json(); assert.equal(t.rows.length, 0); assert.equal(t.status, 'playing');
  await a.call('POST', '/guess', { guess: answerFor(day()) }); const s = await (await a.call('GET', '/stats')).json(); assert.equal(s.currentStreak, 2); assert.equal(s.distribution[0], 1);
  clock = '2026-03-11T10:00:00Z';
});
test('client date: honoured within ±1 day, ignored otherwise (no way to fetch a future puzzle)', async () => {
  const p = player(); assert.equal((await (await p.call('GET', '/today?today=2026-03-12')).json()).date, '2026-03-12'); assert.equal((await (await p.call('GET', '/today?today=2026-03-20')).json()).date, '2026-03-11'); assert.equal((await (await p.call('GET', '/today?today=2026-02-30')).json()).date, '2026-03-11');
});
test('stats(): streak rules (gap breaks; yesterday still counts until today is missed)', () => {
  const W = (day, n = 3) => ({ day, status: 'won', guesses: JSON.stringify(Array(n).fill('x')) }), L = (day) => ({ day, status: 'lost', guesses: '[]' });
  assert.equal(stats([W(8), W(9), W(10)], 10).currentStreak, 3); assert.equal(stats([W(8), W(9)], 10).currentStreak, 2, 'today not played yet'); assert.equal(stats([W(7), W(8)], 10).currentStreak, 0); assert.equal(stats([W(1), W(2), W(3), W(5), W(6)], 6).maxStreak, 3);
  assert.equal(stats([W(8), L(9), W(10)], 10).currentStreak, 1); assert.equal(stats([{ day: 4, status: 'playing', guesses: '[]' }], 4).played, 0);
});
test('static: word list is not served; errors', async () => {
  assert.equal((await fetch(base + '/words.js')).status, 404); assert.equal((await fetch(base + '/src/words.js')).status, 404); assert.match(await (await fetch(base + '/game.js')).text(), /export function score/); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  assert.equal((await fetch(base + '/api/guess', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/api/nope')).status, 404);
});
