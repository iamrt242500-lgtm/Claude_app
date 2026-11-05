import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, nowIso = '2026-03-10T12:00:00Z';
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const hit = (code, headers = {}, method = 'GET') => fetch(base + '/s/' + code, { method, redirect: 'manual', headers });
before(async () => { server = createApp({ now: () => new Date(nowIso) }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const mk = async (b) => (await call('POST', '/links', b)).json();

test('create with random and custom codes; duplicates; validation errors reported together', async () => {
  const a = await mk({ url: 'example.com/page', title: 'Ex' }); assert.match(a.code, /^[A-Za-z0-9]{6}$/); assert.equal(a.url, 'https://example.com/page'); assert.equal(a.clicks, 0);
  const b = await mk({ url: 'https://example.org', slug: 'My-Slug' }); assert.equal(b.code, 'My-Slug');
  const dup = await call('POST', '/links', { url: 'https://example.org', slug: 'my-slug' }); assert.equal(dup.status, 409);
  const bad = await call('POST', '/links', { url: 'javascript:alert(1)', slug: 'api', expiresOn: '2020-01-01', title: 'x'.repeat(101) }); assert.equal(bad.status, 422);
  assert.deepEqual(Object.keys((await bad.json()).details).sort(), ['expiresOn', 'slug', 'title', 'url']);
  const loop = await call('POST', '/links', { url: `http://${new URL(base).host}/s/abc` }); assert.equal(loop.status, 422);
});
test('redirect: 302 + Location, counts GET only, case-insensitive code, unknown 404', async () => {
  const l = await mk({ url: 'https://example.com/target?x=1', slug: 'Go-Here' });
  const r = await hit('Go-Here'); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://example.com/target?x=1'); assert.match(r.headers.get('cache-control'), /no-store/);
  assert.equal((await hit('go-here')).status, 302); assert.equal((await hit('Go-Here', {}, 'HEAD')).status, 302);
  assert.equal((await (await call('GET', `/links/${l.id}`)).json()).clicks, 2, 'HEAD is not counted');
  const nf = await hit('nope123'); assert.equal(nf.status, 404); assert.match(await nf.text(), /does not exist/);
});
test('analytics: bots separated, devices, referrers, 30-day series', async () => {
  const l = await mk({ url: 'https://example.com/a', slug: 'stats1' });
  await hit('stats1', { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', referer: 'https://www.google.com/x' }); await hit('stats1', { 'user-agent': 'Mozilla/5.0 (X11) Chrome', referer: 'https://news.ycombinator.com/' });
  await hit('stats1', { 'user-agent': 'Mozilla/5.0 (X11) Chrome', referer: 'https://www.google.com/y' }); await hit('stats1', { 'user-agent': 'Googlebot/2.1' }); await hit('stats1', { 'user-agent': 'Mozilla/5.0 (X11) Chrome' });
  const a = await (await call('GET', `/links/${l.id}`)).json();
  assert.equal(a.clicks, 5); assert.equal(a.humanClicks, 4); assert.equal(a.botClicks, 1); assert.equal(a.days.length, 30); assert.equal(a.days.at(-1).day, '2026-03-10'); assert.equal(a.days.at(-1).clicks, 4);
  assert.deepEqual(a.referrers[0], { name: 'google.com', n: 2 }); assert.ok(a.referrers.some((r) => r.name === '(direct)' && r.n === 1)); assert.deepEqual(a.devices.map((d) => [d.device, d.n]), [['desktop', 3], ['mobile', 1]]);
});
test('disable/enable, expiry (valid through expiry day, gone after), delete cascades', async () => {
  const l = await mk({ url: 'https://example.com/e', slug: 'exp1', expiresOn: '2026-03-10' });
  assert.equal((await hit('exp1')).status, 302, 'still valid on its expiry day');
  const off = await (await call('PATCH', `/links/${l.id}`, { disabled: true })).json(); assert.equal(off.disabled, true); const g = await hit('exp1'); assert.equal(g.status, 410); assert.match(await g.text(), /turned this link off/);
  await call('PATCH', `/links/${l.id}`, { disabled: false }); assert.equal((await hit('exp1')).status, 302);
  nowIso = '2026-03-11T00:00:01Z'; const ex = await hit('exp1'); assert.equal(ex.status, 410); assert.match(await ex.text(), /expired/); assert.equal((await (await call('GET', `/links/${l.id}`)).json()).expired, true);
  assert.equal((await call('PATCH', `/links/${l.id}`, { expiresOn: '2026-12-31' })).status, 200); assert.equal((await hit('exp1')).status, 302, 'extending the expiry revives it');
  assert.equal((await call('PATCH', `/links/${l.id}`, { expiresOn: '2020-01-01' })).status, 422); assert.equal((await call('PATCH', `/links/${l.id}`, { disabled: 'yes' })).status, 422);
  assert.equal((await call('DELETE', `/links/${l.id}`)).status, 204); assert.equal((await hit('exp1')).status, 404); assert.equal((await call('GET', `/links/${l.id}`)).status, 404);
});
test('errors, static, path handling', async () => {
  assert.equal((await call('GET', '/links/abc')).status, 400); assert.equal((await call('GET', '/links/99999')).status, 404);
  assert.equal((await fetch(base + '/api/links', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  assert.equal((await fetch(base + '/')).status, 200); assert.equal((await hit('bad.code!')).status, 404); assert.equal((await fetch(base + '/s/x', { method: 'POST' })).status, 405);
});
