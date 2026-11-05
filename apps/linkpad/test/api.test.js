import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const mk = async (title, body = '') => (await call('POST', '/notes', { title, body })).json();

test('create, validate, uniqueness is case-insensitive', async () => {
  assert.equal((await call('POST', '/notes', { title: '' })).status, 422);
  const a = await mk('Alpha', 'hello'); assert.equal(a.title, 'Alpha');
  const dup = await call('POST', '/notes', { title: 'alpha' }); assert.equal(dup.status, 422); assert.match((await dup.json()).details.title, /already exists/);
});
test('links, backlinks, ghost links resolve once the target is created', async () => {
  const hub = await mk('Hub', 'Links: [[Spoke One]] and [[Ghost]] and [[spoke one|again]]');
  let d = await (await call('GET', `/notes/${hub.id}`)).json();
  assert.deepEqual(d.links.map((l) => [l.target, l.id]), [['spoke one', null], ['ghost', null]]);
  const s1 = await mk('Spoke One', 'back to [[hub]]');
  d = await (await call('GET', `/notes/${hub.id}`)).json(); assert.equal(d.links[0].id, s1.id); assert.equal(d.links[0].title, 'Spoke One');
  assert.deepEqual(s1.backlinks.map((b) => b.title), ['Hub']);
  const s1d = await (await call('GET', `/notes/${s1.id}`)).json(); assert.deepEqual(s1d.backlinks.map((b) => b.title), ['Hub']);
  const hubd = await (await call('GET', `/notes/${hub.id}`)).json(); assert.deepEqual(hubd.backlinks.map((b) => b.title), ['Spoke One']);
  const ghost = await mk('GHOST', ''); assert.deepEqual(ghost.backlinks.map((b) => b.title), ['Hub'], 'case-insensitive ghost link');
});
test('rename rewrites links in other notes (keeping labels), self-links excluded from backlinks', async () => {
  const t = await mk('Target', 'self [[Target]]'); const r = await mk('Referrer', 'see [[Target]] and [[target|the thing]] and `[[Target]]`');
  assert.deepEqual((await (await call('GET', `/notes/${t.id}`)).json()).backlinks.map((b) => b.title), ['Referrer'], 'no self backlink');
  const upd = await (await call('PUT', `/notes/${t.id}`, { title: 'Renamed Target', body: 'self [[Renamed Target]]' })).json();
  assert.deepEqual(upd.backlinks.map((b) => b.title), ['Referrer']);
  const rd = await (await call('GET', `/notes/${r.id}`)).json(); assert.equal(rd.body, 'see [[Renamed Target]] and [[Renamed Target|the thing]] and `[[Target]]`');
  assert.equal((await call('PUT', `/notes/${t.id}`, { title: 'hub', body: '' })).status, 422, 'cannot rename onto an existing title');
  const same = await call('PUT', `/notes/${t.id}`, { title: 'renamed target', body: 'x' }); assert.equal(same.status, 200, 'case-only rename of itself is allowed');
});
test('full-text search with ranking and hostile input; resolve; delete cleans up', async () => {
  const a = await mk('Quantum computing', 'qubits and superposition'); await mk('Cooking', 'quantum of flavour');
  let r = await (await call('GET', '/notes?q=quantum')).json(); assert.equal(r[0].id, a.id, 'title match first'); assert.ok(r.every((x) => x.match));
  assert.equal((await (await call('GET', '/notes?q=' + encodeURIComponent('"; DROP TABLE notes;--'))).json()).length, 0); assert.deepEqual(await (await call('GET', '/notes?q=***')).json(), []);
  assert.equal((await (await call('GET', '/notes?q=superpos')).json()).length, 1);
  assert.equal((await (await call('GET', '/resolve?title=QUANTUM%20computing')).json()).id, a.id); assert.equal(await (await call('GET', '/resolve?title=nope')).json(), null);
  assert.equal((await call('DELETE', `/notes/${a.id}`)).status, 204); assert.equal((await (await call('GET', '/notes?q=superposition')).json()).length, 0); assert.equal((await call('GET', `/notes/${a.id}`)).status, 404);
});
test('errors and static', async () => {
  assert.equal((await call('GET', '/notes/abc')).status, 400); assert.equal((await call('GET', '/notes/99999')).status, 404);
  assert.equal((await fetch(base + '/api/notes', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  const md = await fetch(base + '/md.js'); assert.equal(md.status, 200); assert.match(md.headers.get('content-type'), /javascript/);
});
