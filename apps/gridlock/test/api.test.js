import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, parseId } from '../src/server.js';
import { solve, generate } from '../src/sudoku.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ now: () => new Date('2026-03-11T10:00:00Z') }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const set = (s, i, d) => s.slice(0, i) + d + s.slice(i + 1);

test('parseId', () => { assert.deepEqual(parseId('hard-42'), { difficulty: 'hard', seed: 42 }); for (const bad of ['hard', 'x-1', 'easy-', 'easy-99999999999', 'easy-2147483648', null, 'easy-1-2']) assert.equal(parseId(bad), null, String(bad)); });
test('puzzle: deterministic by seed, unique solution, solution never sent; daily is stable per date', async () => {
  const a = await (await call('GET', '/puzzle?difficulty=easy&seed=5')).json(); const b = await (await call('GET', '/puzzle?difficulty=easy&seed=5')).json(); assert.deepEqual(a, b); assert.equal(a.id, 'easy-5'); assert.equal(solve(a.puzzle, 2).count, 1); assert.ok(!('solution' in a));
  const d1 = await (await call('GET', '/puzzle?daily=1')).json(), d2 = await (await call('GET', '/puzzle?daily=1&today=2026-03-12')).json(), d3 = await (await call('GET', '/puzzle?daily=1&today=2030-01-01')).json(); assert.equal(d1.id, 'medium-20260311'); assert.equal(d2.id, 'medium-20260312'); assert.equal(d3.id, 'medium-20260311', 'far-off client date ignored');
  const r = await (await call('GET', '/puzzle')).json(); assert.match(r.id, /^medium-\d+$/);
  for (const [qs, k] of [['difficulty=insane', 'difficulty'], ['seed=-1', 'seed'], ['seed=1.5', 'seed'], ['seed=99999999999', 'seed']]) { const x = await call('GET', '/puzzle?' + qs); assert.equal(x.status, 422, qs); assert.ok((await x.json()).details[k]); }
});
test('check: reports conflicts and wrong digits separately; solved flag; refuses changed givens', async () => {
  const id = 'easy-5', pz = await (await call('GET', '/puzzle?difficulty=easy&seed=5')).json(), sol = solve(pz.puzzle).solution, empty = [...pz.puzzle].findIndex((c) => c === '.');
  let r = await (await call('POST', '/check', { id, board: pz.puzzle })).json(); assert.deepEqual(r, { conflicts: [], wrong: [], complete: false, solved: false });
  const wrongDigit = sol[empty] === '9' ? '8' : '9'; r = await (await call('POST', '/check', { id, board: set(pz.puzzle, empty, wrongDigit) })).json(); assert.deepEqual(r.wrong, [empty]);
  r = await (await call('POST', '/check', { id, board: sol })).json(); assert.deepEqual(r, { conflicts: [], wrong: [], complete: true, solved: true });
  const given = [...pz.puzzle].findIndex((c) => c !== '.'); const bad = await call('POST', '/check', { id, board: set(pz.puzzle, given, pz.puzzle[given] === '1' ? '2' : '1') }); assert.equal(bad.status, 422); assert.match((await bad.json()).details.board, /given/);
  assert.equal((await call('POST', '/check', { id, board: 'abc' })).status, 422); assert.equal((await call('POST', '/check', { id: 'nope', board: pz.puzzle })).status, 400);
});
test('hint: returns a correct digit for the most constrained empty cell; 409 when solved', async () => {
  const pz = await (await call('GET', '/puzzle?difficulty=easy&seed=5')).json(), sol = solve(pz.puzzle).solution; const h = await (await call('POST', '/hint', { id: 'easy-5', board: pz.puzzle })).json();
  assert.equal(pz.puzzle[h.index], '.'); assert.equal(h.digit, sol[h.index]); assert.equal((await call('POST', '/hint', { id: 'easy-5', board: sol })).status, 409);
});
test('games: start/resume, progress, solve records time, hints counted, no changes after solving, stats', async () => {
  const id = 'easy-9', pz = generate(9, 'easy'); const s1 = await call('POST', '/games', { id }); assert.equal(s1.status, 201); assert.equal((await s1.json()).board, pz.puzzle); assert.equal((await call('POST', '/games', { id })).status, 200, 'resume, not duplicate');
  const empty = [...pz.puzzle].findIndex((c) => c === '.'); const partial = set(pz.puzzle, empty, pz.solution[empty]); let g = await (await call('PUT', `/games/${id}`, { board: partial, seconds: 30 })).json(); assert.equal(g.board, partial); assert.equal(g.seconds, 30);
  await call('POST', '/hint', { id, board: partial }); assert.equal((await (await call('GET', `/games/${id}`)).json()).hints, 1);
  const back = await call('PUT', `/games/${id}`, { board: partial, seconds: 10 }); assert.equal(back.status, 422); assert.equal((await call('PUT', `/games/${id}`, { board: partial, seconds: 1.5 })).status, 422);
  g = await (await call('PUT', `/games/${id}`, { board: pz.solution, seconds: 95 })).json(); assert.equal(g.status, 'solved'); assert.equal((await call('PUT', `/games/${id}`, { board: pz.solution, seconds: 96 })).status, 409);
  const st = await (await call('GET', '/stats')).json(); assert.deepEqual(st.easy, { solved: 1, bestClean: null, bestAny: 95, inProgress: 0 }, 'a hinted solve is not a clean record'); assert.equal(st.hard.solved, 0);
  const id2 = 'easy-10'; await call('POST', '/games', { id: id2 }); await call('PUT', `/games/${id2}`, { board: generate(10, 'easy').solution, seconds: 120 }); assert.equal((await (await call('GET', '/stats')).json()).easy.bestClean, 120); assert.equal((await (await call('GET', '/stats')).json()).easy.bestAny, 95);
  assert.equal((await call('DELETE', `/games/${id2}`)).status, 204); assert.equal((await call('GET', `/games/${id2}`)).status, 404); assert.equal((await call('GET', '/games/zzz')).status, 400);
});
test('errors and static', async () => {
  assert.equal((await fetch(base + '/api/check', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.match(await (await fetch(base + '/sudoku.js')).text(), /export function solve/);
});
