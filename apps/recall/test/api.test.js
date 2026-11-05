import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, day = '2026-03-01';
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ today: () => day }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test('deck + card lifecycle, grading moves due date, time travel brings it back', async () => {
  const deck = await (await call('POST', '/decks', { name: 'Geo' })).json();
  const imp = await call('POST', `/decks/${deck.id}/cards`, { bulk: 'France :: Paris\nJapan :: Tokyo' });
  assert.equal(imp.status, 201); assert.equal((await imp.json()).imported, 2);
  const one = await (await call('POST', `/decks/${deck.id}/cards`, { front: 'Peru', back: 'Lima' })).json();
  let study = await (await call('GET', `/decks/${deck.id}/study`)).json(); assert.equal(study.length, 3);
  const g = await (await call('POST', `/cards/${one.id}/grade`, { grade: 3 })).json();
  assert.equal(g.due, '2026-03-02'); assert.equal(g.reps, 1);
  study = await (await call('GET', `/decks/${deck.id}/study`)).json(); assert.equal(study.length, 2);
  let stats = await (await call('GET', '/stats')).json();
  assert.equal(stats.reviews, 1); assert.equal(stats.reviewedToday, 1); assert.equal(stats.retention, 100); assert.equal(stats.due, 2);
  day = '2026-03-02';
  study = await (await call('GET', `/decks/${deck.id}/study`)).json(); assert.equal(study.length, 3);
  await call('POST', `/cards/${one.id}/grade`, { grade: 1 });
  stats = await (await call('GET', '/stats')).json(); assert.equal(stats.retention, 50);
  const decks = await (await call('GET', '/decks')).json(); assert.equal(decks[0].cards, 3);
  assert.equal((await call('PUT', `/cards/${one.id}`, { front: 'Peru?', back: 'Lima' })).status, 200);
  assert.equal((await call('DELETE', `/cards/${one.id}`)).status, 204);
  assert.equal((await call('DELETE', `/decks/${deck.id}`)).status, 204);
  assert.equal((await (await call('GET', '/stats')).json()).cards, 0, 'cascade delete');
});
test('validation and errors', async () => {
  assert.equal((await call('POST', '/decks', { name: ' ' })).status, 422);
  assert.equal((await call('POST', '/decks', { name: 'x'.repeat(81) })).status, 422);
  const d = await (await call('POST', '/decks', { name: 'V' })).json();
  assert.equal((await call('POST', `/decks/${d.id}/cards`, { front: 'a' })).status, 422);
  const r = await call('POST', `/decks/${d.id}/cards`, { bulk: 'ok :: fine\nbroken' });
  assert.equal(r.status, 422); assert.match((await r.json()).details.bulk, /2/);
  assert.equal((await call('GET', '/decks/999')).status, 404);
  assert.equal((await call('GET', '/decks/abc')).status, 400);
  assert.equal((await call('POST', '/cards/999/grade', { grade: 3 })).status, 404);
  const c = await (await call('POST', `/decks/${d.id}/cards`, { front: 'q', back: 'a' })).json();
  assert.equal((await call('POST', `/cards/${c.id}/grade`, { grade: 7 })).status, 422);
  assert.equal((await fetch(base + '/api/decks', { method: 'POST', body: '{bad' })).status, 400);
});
test('static + traversal + headers', async () => {
  const r = await fetch(base + '/'); assert.equal(r.status, 200); assert.ok(r.headers.get('content-security-policy'));
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  assert.equal((await fetch(base + '/%zz')).status, 400);
});
