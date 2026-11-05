import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const titles = (board, i) => board.columns[i].cards.map((c) => c.title);

test('board with default columns, cards CRUD, ordering and moves', async () => {
  assert.equal((await call('POST', '/boards', { name: '' })).status, 422);
  const b = await (await call('POST', '/boards', { name: 'Launch' })).json();
  assert.deepEqual(b.columns.map((c) => c.name), ['To do', 'Doing', 'Done']);
  const [todo, doing, done] = b.columns.map((c) => c.id);
  const mk = async (col, title, extra = {}) => (await (await call('POST', `/columns/${col}/cards`, { title, ...extra })).json());
  const a = await mk(todo, 'A', { labels: 'Bug, ui', due: '2026-05-01' }), bb = await mk(todo, 'B'), c = await mk(todo, 'C');
  assert.deepEqual(a.labels, ['bug', 'ui']);
  let full = await (await call('GET', `/boards/${b.id}`)).json(); assert.deepEqual(titles(full, 0), ['A', 'B', 'C']);
  full = await (await call('POST', `/cards/${c.id}/move`, { columnId: todo, index: 0 })).json(); assert.deepEqual(titles(full, 0), ['C', 'A', 'B']);
  full = await (await call('POST', `/cards/${a.id}/move`, { columnId: doing, index: 0 })).json();
  assert.deepEqual(titles(full, 0), ['C', 'B']); assert.deepEqual(titles(full, 1), ['A']);
  full = await (await call('POST', `/cards/${bb.id}/move`, { columnId: doing, index: 0 })).json(); assert.deepEqual(titles(full, 1), ['B', 'A']);
  assert.deepEqual(full.columns[0].cards.map((x) => x.position), [0]); assert.deepEqual(full.columns[1].cards.map((x) => x.position), [0, 1]);
  full = await (await call('POST', `/cards/${a.id}/move`, { columnId: done })).json(); assert.deepEqual(titles(full, 2), ['A']);
  const upd = await (await call('PUT', `/cards/${a.id}`, { title: 'A2', description: 'd', due: null, labels: [] })).json(); assert.equal(upd.title, 'A2'); assert.equal(upd.due, null);
  assert.equal((await call('DELETE', `/cards/${c.id}`)).status, 204);
  full = await (await call('GET', `/boards/${b.id}`)).json(); assert.deepEqual(titles(full, 0), []);
});
test('validation and cross-board protection', async () => {
  const b1 = await (await call('POST', '/boards', { name: 'One' })).json(), b2 = await (await call('POST', '/boards', { name: 'Two' })).json();
  const card = await (await call('POST', `/columns/${b1.columns[0].id}/cards`, { title: 'X' })).json();
  assert.equal((await call('POST', `/columns/${b1.columns[0].id}/cards`, { title: '  ' })).status, 422);
  assert.equal((await call('POST', `/columns/${b1.columns[0].id}/cards`, { title: 'x', due: 'soon' })).status, 422);
  assert.equal((await call('POST', `/cards/${card.id}/move`, { columnId: b2.columns[0].id })).status, 422);
  assert.equal((await call('POST', `/cards/${card.id}/move`, { columnId: 99999 })).status, 404);
  assert.equal((await call('POST', `/cards/${card.id}/move`, { columnId: b1.columns[1].id, index: 'x' })).status, 422);
  assert.equal((await call('GET', '/boards/999')).status, 404); assert.equal((await call('GET', '/boards/abc')).status, 400);
  assert.equal((await fetch(base + '/api/boards', { method: 'POST', body: '{x' })).status, 400);
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
test('columns: add, rename, delete (renumbers), limits, cascade', async () => {
  const b = await (await call('POST', '/boards', { name: 'Cols' })).json();
  let full = await (await call('POST', `/boards/${b.id}/columns`, { name: 'Review' })).json(); assert.equal(full.columns.length, 4);
  const rid = full.columns[3].id; await call('POST', `/columns/${rid}/cards`, { title: 'in review' });
  full = await (await call('PUT', `/columns/${rid}`, { name: 'QA' })).json(); assert.equal(full.columns[3].name, 'QA');
  full = await (await call('DELETE', `/columns/${full.columns[0].id}`)).json(); assert.deepEqual(full.columns.map((c) => c.name), ['Doing', 'Done', 'QA']);
  for (let i = 0; i < 9; i++) await call('POST', `/boards/${b.id}/columns`, { name: 'c' + i });
  assert.equal((await call('POST', `/boards/${b.id}/columns`, { name: 'over' })).status, 409);
  const single = await (await call('POST', '/boards', { name: 'S' })).json();
  await call('DELETE', `/columns/${single.columns[0].id}`); await call('DELETE', `/columns/${single.columns[1].id}`);
  assert.equal((await call('DELETE', `/columns/${single.columns[2].id}`)).status, 409);
  assert.equal((await call('DELETE', `/boards/${b.id}`)).status, 204);
  assert.equal((await call('GET', `/columns/${rid}`)).status, 404);
});
