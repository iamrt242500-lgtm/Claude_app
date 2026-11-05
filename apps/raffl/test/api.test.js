import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, compute } from '../src/server.js';

let base, server;
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
const NAMES = 'Ann\nBen\nCy\nDi\nEd\nFlo';

test('compute is deterministic per (kind, entries, seed, params) and differs across seeds and kinds', () => {
  const a = compute('winners', NAMES, 'abc', { count: 2 }), b = compute('winners', NAMES, 'abc', { count: 2 }); assert.deepEqual(a, b);
  const seeds = new Set(Array.from({ length: 30 }, (_, i) => compute('winners', NAMES, 's' + i, { count: 1 }).result.winners[0])); assert.ok(seeds.size >= 4, 'different seeds pick different people'); assert.equal(compute('groups', NAMES, 'abc', { groups: 2 }).result.groups.flat().length, 6);
});
test('create a winners draw: random seed when none given, stored, weights respected in parsing', async () => {
  const d = await (await call('POST', '/draws', { kind: 'winners', title: ' Prize ', entries: 'Ann x3\nBen\nCy', params: { count: 2 } })).json(); assert.equal(d.title, 'Prize'); assert.match(d.seed, /^[0-9a-f]{12}$/); assert.equal(d.result.winners.length, 2); assert.equal(new Set(d.result.winners).size, 2);
  const again = await J('GET', `/draws/${d.id}`); assert.deepEqual(again.result, d.result); assert.equal(again.entries, 'Ann x3\nBen\nCy');
});
test('verification: stored draws re-compute identically; tampered results are detected', async () => {
  const d = await J('POST', '/draws', { kind: 'groups', entries: NAMES, seed: 'public-seed', params: { groups: 3 } }); assert.equal(d.seed, 'public-seed'); assert.deepEqual(d.result.groups.map((g) => g.length), [2, 2, 2]);
  assert.equal((await J('GET', `/draws/${d.id}/verify`)).matches, true); const v = await J('POST', '/verify', { kind: 'groups', entries: NAMES, seed: 'public-seed', params: { groups: 3 }, result: d.result }); assert.equal(v.matches, true); assert.deepEqual(v.result, d.result);
  const fake = { groups: [...d.result.groups].reverse() }; assert.equal((await J('POST', '/verify', { kind: 'groups', entries: NAMES, seed: 'public-seed', params: { groups: 3 }, result: fake })).matches, false); assert.equal((await J('POST', '/verify', { kind: 'groups', entries: NAMES, seed: 'public-seed', params: { groups: 3 } })).matches, null);
});
test('secret santa: valid derangement, ring option', async () => {
  const d = await J('POST', '/draws', { kind: 'santa', entries: NAMES, seed: 'xmas' }); const pairs = d.result.pairs; assert.equal(Object.keys(pairs).length, 6); assert.ok(Object.entries(pairs).every(([a, b]) => a !== b)); assert.equal(new Set(Object.values(pairs)).size, 6); assert.equal(d.params.ring, true);
  const loose = await J('POST', '/draws', { kind: 'santa', entries: NAMES, seed: 'xmas', params: { ring: false } }); assert.ok(Object.entries(loose.result.pairs).every(([a, b]) => a !== b)); assert.equal((await call('POST', '/draws', { kind: 'santa', entries: 'Solo' })).status, 422);
});
test('validation: kind, entries, counts, seed, title', async () => {
  for (const [b, k] of [[{ kind: 'lottery', entries: NAMES }, 'kind'], [{ kind: 'winners', entries: '' }, 'entries'], [{ kind: 'winners', entries: 'A x0' }, 'entries'], [{ kind: 'winners', entries: NAMES, params: { count: 0 } }, 'count'], [{ kind: 'winners', entries: NAMES, params: { count: 7 } }, 'count'], [{ kind: 'groups', entries: NAMES, params: { groups: 1 } }, 'groups'], [{ kind: 'groups', entries: 'A\nB', params: { groups: 3 } }, 'groups'], [{ kind: 'winners', entries: NAMES, seed: 's'.repeat(101) }, 'seed'], [{ kind: 'winners', entries: NAMES, title: 't'.repeat(81) }, 'title'], [{ kind: 'groups', entries: 'A' }, 'entries']]) { const r = await call('POST', '/draws', b); assert.equal(r.status, 422, JSON.stringify(b).slice(0, 80)); assert.ok((await r.json()).details[k], k); }
  assert.equal((await call('POST', '/draws', { kind: 'winners', entries: Array.from({ length: 501 }, (_, i) => 'p' + i).join('\n') })).status, 422);
});
test('history, delete, errors', async () => {
  const list = await J('GET', '/draws'); assert.ok(list.length >= 4); assert.ok(list[0].id > list.at(-1).id); assert.ok(list.every((d) => d.entryCount >= 1)); const id = list[0].id; assert.equal((await call('DELETE', `/draws/${id}`)).status, 204); assert.equal((await call('GET', `/draws/${id}`)).status, 404); assert.equal((await call('GET', '/draws/zz')).status, 400);
  assert.equal((await fetch(base + '/api/draws', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.match(await (await fetch(base + '/draw.js')).text(), /export function drawWinners/);
});
