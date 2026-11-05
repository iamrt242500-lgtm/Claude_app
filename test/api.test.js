import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, authed, authBase;
const body = { title: 'Move to Berlin', context: 'c', choice: 'go', prediction: 'Happier', confidence: 75, decidedAt: '2026-01-01', reviewOn: '2026-03-01', tags: ['life'] };
const j = (m, p, b, b0 = base, headers = {}) => fetch(b0 + p, { method: m, headers: { 'Content-Type': 'application/json', ...headers }, body: b === undefined ? undefined : JSON.stringify(b) });

before(async () => {
  server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`;
  authed = createApp({ password: 'pw' }).server; await new Promise((r) => authed.listen(0, r)); authBase = `http://127.0.0.1:${authed.address().port}`;
});
after(() => { server.close(); authed.close(); });

test('full CRUD + review lifecycle', async () => {
  let r = await j('POST', '/api/decisions', body);
  assert.equal(r.status, 201); const d = await r.json(); assert.equal(d.status, 'open');
  r = await j('PUT', `/api/decisions/${d.id}`, { ...body, title: 'Berlin!' });
  assert.equal((await r.json()).title, 'Berlin!');
  r = await j('POST', `/api/decisions/${d.id}/review`, { outcome: 'hit', outcomeNote: 'yes' });
  const rev = await r.json(); assert.equal(rev.status, 'reviewed'); assert.equal(rev.outcome, 'hit');
  const stats = await (await j('GET', '/api/stats')).json(); assert.equal(stats.reviewed, 1); assert.equal(stats.hitRate, 100);
  r = await j('POST', `/api/decisions/${d.id}/reopen`); assert.equal((await r.json()).status, 'open');
  assert.equal((await j('DELETE', `/api/decisions/${d.id}`)).status, 204);
  assert.equal((await j('GET', `/api/decisions/${d.id}`)).status, 404);
});
test('validation errors return 422 with field details', async () => {
  const r = await j('POST', '/api/decisions', { title: '' });
  assert.equal(r.status, 422); assert.ok((await r.json()).details.title);
});
test('bad JSON, bad id, unknown route, bad method', async () => {
  const raw = await fetch(base + '/api/decisions', { method: 'POST', body: '{nope' });
  assert.equal(raw.status, 400);
  assert.equal((await j('GET', '/api/decisions/abc')).status, 400);
  assert.equal((await j('GET', '/api/nothing')).status, 404);
  assert.equal((await j('PATCH', '/api/decisions')).status, 405);
  assert.equal((await j('POST', '/api/decisions/999/review', { outcome: 'hit' })).status, 404);
});
test('csv export neutralizes formula injection', async () => {
  await j('POST', '/api/decisions', { ...body, title: '=HYPERLINK("x")' });
  const csv = await (await j('GET', '/api/export?format=csv')).text();
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
});
test('static files served; traversal blocked; security headers', async () => {
  const r = await fetch(base + '/'); assert.equal(r.status, 200);
  assert.ok(r.headers.get('content-security-policy'));
  assert.equal((await fetch(base + '/..%2fpackage.json')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
test('password protection', async () => {
  assert.equal((await fetch(authBase + '/api/decisions')).status, 401);
  assert.equal((await fetch(authBase + '/api/health')).status, 200);
  const good = 'Basic ' + Buffer.from('hindsight:pw').toString('base64');
  assert.equal((await fetch(authBase + '/api/decisions', { headers: { Authorization: good } })).status, 200);
  const bad = 'Basic ' + Buffer.from('hindsight:no').toString('base64');
  assert.equal((await fetch(authBase + '/api/decisions', { headers: { Authorization: bad } })).status, 401);
});
