import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const result = (t, m, sa, sb) => call('PUT', `/tournaments/${t}/matches/${m}/result`, { sa, sb });
const find = (t, round, idx) => t.matches.find((m) => m.round === round && m.idx === idx);

test('create: validation (names, count, duplicates, format) and accepted formats for players', async () => {
  for (const [b, k] of [[{ name: '', format: 'knockout', players: ['a', 'b'] }, 'name'], [{ name: 'x', format: 'swiss', players: ['a', 'b'] }, 'format'], [{ name: 'x', format: 'knockout', players: ['a'] }, 'players'], [{ name: 'x', format: 'knockout', players: ['a', 'A'] }, 'players'], [{ name: 'x', format: 'knockout', players: Array.from({ length: 33 }, (_, i) => 'p' + i) }, 'players'], [{ name: 'x', format: 'knockout', players: ['a', 5] }, 'players'], [{ name: 'x', format: 'knockout', players: ['a', 'b'.repeat(31)] }, 'players']]) { const r = await call('POST', '/tournaments', b); assert.equal(r.status, 422, JSON.stringify(b).slice(0, 60)); assert.ok((await r.json()).details[k], k); }
  const t = await J('POST', '/tournaments', { name: 'T', format: 'roundrobin', players: ' Ann \n\n Bob  Lee \nCy' }); assert.deepEqual(t.players, ['Ann', 'Bob Lee', 'Cy']);
});
test('round robin: fixtures, results, standings with tiebreaks, completion and champion', async () => {
  const t = await J('POST', '/tournaments', { name: 'League', format: 'roundrobin', players: ['A', 'B', 'C'] }); assert.equal(t.matches.length, 3); assert.equal(t.progress.total, 3); assert.equal(t.champion, null);
  const by = (a, b) => t.matches.find((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a)); const set = async (a, b, sa, sb) => { const m = by(a, b); const [x, y] = m.a === a ? [sa, sb] : [sb, sa]; return (await result(t.id, m.id, x, y)); };
  assert.equal((await set(0, 1, 2, 0)).status, 200); assert.equal((await set(0, 2, 1, 1)).status, 200); let cur = await J('GET', `/tournaments/${t.id}`); assert.equal(cur.champion, null); assert.deepEqual(cur.progress, { played: 2, total: 3 });
  await set(1, 2, 0, 3); cur = await J('GET', `/tournaments/${t.id}`); assert.deepEqual(cur.standings.map((r) => r.i), [2, 0, 1]); assert.equal(cur.champion, 2); const draw = await set(1, 0, 5, 5); assert.equal(draw.status, 200, 'results can be edited');
});
test('knockout with 5 players: byes advance automatically; results flow to the next round; champion', async () => {
  const t = await J('POST', '/tournaments', { name: 'Cup', format: 'knockout', players: ['S1', 'S2', 'S3', 'S4', 'S5'] }); assert.equal(t.rounds, 3);
  const bye = t.matches.filter((m) => m.bye); assert.equal(bye.length, 3); assert.deepEqual(find(t, 0, 0), { ...find(t, 0, 0), a: 0, b: null, winner: 0, bye: true });
  assert.equal(find(t, 1, 0).a, 0, 'seed 1 already waits in round 2'); assert.equal(find(t, 1, 0).b, null); assert.equal((await result(t.id, find(t, 1, 0).id, 1, 0)).status, 409, 'waiting for the 4-v-5 match');
  assert.equal((await result(t.id, find(t, 0, 0).id, 1, 0)).status, 409, 'byes have no result');
  let cur = await (await result(t.id, find(t, 0, 1).id, 3, 1)).json(); assert.equal(find(cur, 0, 1).winner, 3, 'seed 4 beat seed 5'); assert.equal(find(cur, 1, 0).b, 3);
  assert.equal((await result(t.id, find(cur, 0, 1).id, 2, 2)).status, 422, 'no draws in knockout');
  cur = await (await result(t.id, find(cur, 1, 0).id, 0, 2)).json(); assert.equal(find(cur, 1, 0).winner, 3); assert.equal(find(cur, 2, 0).a, 3); assert.equal(cur.champion, null);
  cur = await (await result(t.id, find(cur, 1, 1).id, 4, 1)).json(); cur = await (await result(t.id, find(cur, 2, 0).id, 1, 2)).json(); assert.equal(cur.champion, find(cur, 1, 1).winner); assert.deepEqual(cur.progress, { played: 4, total: 4 });
});
test('knockout: changing a decided winner re-routes the bracket unless the next match was already played', async () => {
  const t = await J('POST', '/tournaments', { name: 'Four', format: 'knockout', players: ['A', 'B', 'C', 'D'] }); // semis: 1v4 → A v D, 2v3 → B v C
  let cur = await (await result(t.id, find(t, 0, 0).id, 1, 0)).json(); assert.equal(find(cur, 1, 0).a, 0);
  cur = await (await result(t.id, find(cur, 0, 0).id, 0, 1)).json(); assert.equal(find(cur, 1, 0).a, 3, 'correcting the score re-routes the winner'); cur = await (await result(t.id, find(cur, 0, 0).id, 4, 2)).json();
  cur = await (await result(t.id, find(cur, 0, 1).id, 1, 0)).json(); cur = await (await result(t.id, find(cur, 1, 0).id, 2, 1)).json();
  const flip = await result(t.id, find(cur, 0, 0).id, 0, 3); assert.equal(flip.status, 409); assert.match((await flip.json()).error, /already advanced/);
  assert.equal((await result(t.id, find(cur, 0, 0).id, 9, 0)).status, 200, 'same winner, new score is fine');
  assert.equal((await call('DELETE', `/tournaments/${t.id}/matches/${find(cur, 0, 0).id}/result`)).status, 409); const fin = await call('DELETE', `/tournaments/${t.id}/matches/${find(cur, 1, 0).id}/result`); assert.equal(fin.status, 200); const sem = await call('DELETE', `/tournaments/${t.id}/matches/${find(cur, 0, 0).id}/result`); const after = await sem.json(); assert.equal(find(after, 0, 0).winner, null); assert.equal(find(after, 1, 0).a, null);
});
test('result validation, 404s, list, delete cascade', async () => {
  const t = await J('POST', '/tournaments', { name: 'V', format: 'roundrobin', players: ['A', 'B'] }); const m = t.matches[0].id;
  for (const b of [{ sa: -1, sb: 0 }, { sa: 1.5, sb: 0 }, { sa: '1', sb: 0 }, { sa: 1000, sb: 0 }, {}]) assert.equal((await call('PUT', `/tournaments/${t.id}/matches/${m}/result`, b)).status, 422, JSON.stringify(b));
  assert.equal((await result(t.id, 999999, 1, 0)).status, 404); assert.equal((await call('GET', '/tournaments/999')).status, 404); assert.equal((await call('GET', '/tournaments/zz')).status, 400);
  await result(t.id, m, 1, 0); const list = await J('GET', '/tournaments'); const row = list.find((x) => x.id === t.id); assert.deepEqual(row.progress, { played: 1, total: 1 }); assert.equal(row.champion, 'A'); assert.equal((await call('DELETE', `/tournaments/${t.id}`)).status, 204); assert.equal((await call('GET', `/tournaments/${t.id}`)).status, 404);
  assert.equal((await fetch(base + '/api/tournaments', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
