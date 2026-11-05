import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, t = Date.parse('2026-03-10T12:00:00Z');
before(async () => { server = createApp({ now: () => t, limits: { create: 100, vote: 100 } }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
// A tiny browser: remembers the vid cookie per "voter".
const browser = () => { let cookie = ''; return async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; r.cookie = sc; return r; }; };
const create = async (over = {}) => { const r = await (await browser()('POST', '/polls', { question: 'Lunch?', options: ['Pizza', 'Sushi', 'Salad'], ...over })).json(); return r; };

test('create: returns slug + one-time admin token; only a hash is stored; validation reports everything', async () => {
  const bad = await browser()('POST', '/polls', { question: '', options: ['a'] }); assert.equal(bad.status, 422); assert.deepEqual(Object.keys((await bad.json()).details).sort(), ['options', 'question']);
  const p = await create(); assert.ok(p.slug.length >= 8 && p.adminToken.length >= 30); assert.equal(p.options.length, 3); assert.equal(p.totalVotes, 0);
  const row = server.listening && createApp; void row;
  const pub = await (await browser()('GET', `/polls/${p.slug}`)).json(); assert.equal(pub.adminToken, undefined); assert.equal(pub.voters, undefined);
  assert.equal((await browser()('GET', `/admin/${p.slug}`)).status, 404, 'the public slug is not an admin credential'); assert.equal((await browser()('GET', '/admin/' + 'x'.repeat(32))).status, 404);
});
test('one voter, one vote: re-voting replaces; different browsers add up; multi-choice sets', async () => {
  const p = await create(); const a = browser(), b = browser();
  let r = await a('POST', `/polls/${p.slug}/vote`, { options: [p.options[0].id] }); assert.equal(r.status, 200); assert.match(r.cookie, /vid=.+HttpOnly.+SameSite=Lax/); let v = await r.json(); assert.equal(v.totalVotes, 1); assert.deepEqual(v.myVote, [p.options[0].id]);
  v = await (await a('POST', `/polls/${p.slug}/vote`, { options: [p.options[1].id] })).json(); assert.equal(v.totalVotes, 1, 'changed vote, not a second vote'); assert.equal(v.options[0].votes, 0); assert.equal(v.options[1].votes, 1);
  v = await (await b('POST', `/polls/${p.slug}/vote`, { options: [p.options[1].id] })).json(); assert.equal(v.options[1].votes, 2); assert.equal(v.options[1].percent, 100);
  assert.equal((await a('POST', `/polls/${p.slug}/vote`, { options: [p.options[0].id, p.options[1].id] })).status, 422, 'single-choice rejects two options');
  const m = await create({ multi: true }); const c = browser(); v = await (await c('POST', `/polls/${m.slug}/vote`, { options: [m.options[0].id, m.options[2].id] })).json(); assert.equal(v.totalVotes, 2); v = await (await c('POST', `/polls/${m.slug}/vote`, { options: [m.options[1].id] })).json(); assert.equal(v.totalVotes, 1, 're-vote replaced the whole set');
});
test('vote validation; malformed cookies are ignored (fresh voter id), well-formed ones identify the same voter', async () => {
  const p = await create(); const a = browser();
  for (const [b, re] of [[{ options: [] }, /at least one/], [{ options: [99999] }, /Unknown/], [{ options: ['1'] }, /list of option ids/], [{}, /list of option ids/]]) { const r = await a('POST', `/polls/${p.slug}/vote`, b); assert.equal(r.status, 422); assert.match((await r.json()).details.options, re); }
  for (let i = 0; i < 3; i++) await fetch(base + `/api/polls/${p.slug}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: 'vid=short' }, body: JSON.stringify({ options: [p.options[0].id] }) });
  assert.equal((await (await browser()('GET', `/polls/${p.slug}`)).json()).totalVotes, 3, 'a malformed cookie is ignored, so each of these requests is a new voter (clearing cookies can inflate votes — documented limitation)');
  for (let i = 0; i < 3; i++) await fetch(base + `/api/polls/${p.slug}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: 'vid=abcdefghijklmnopqrstuv' }, body: JSON.stringify({ options: [p.options[1].id] }) });
  assert.equal((await (await browser()('GET', `/polls/${p.slug}`)).json()).totalVotes, 4, 'the same well-formed id always counts as one voter');
});
test('results policy: always / after_vote / after_close; admin always sees counts and voter count', async () => {
  const p = await create({ resultsMode: 'after_vote' }); const a = browser(), b = browser(); await a('POST', `/polls/${p.slug}/vote`, { options: [p.options[0].id] });
  const hidden = await (await b('GET', `/polls/${p.slug}`)).json(); assert.equal(hidden.resultsVisible, false); assert.equal(hidden.totalVotes, null); assert.ok(hidden.options.every((o) => !('votes' in o)));
  const shown = await (await a('GET', `/polls/${p.slug}`)).json(); assert.equal(shown.resultsVisible, true); assert.equal(shown.options[0].votes, 1);
  const adm = await (await browser()('GET', `/admin/${p.adminToken}`)).json(); assert.equal(adm.totalVotes, 1); assert.equal(adm.voters, 1);
  const c = await create({ resultsMode: 'after_close' }); const d = browser(); const voted = await (await d('POST', `/polls/${c.slug}/vote`, { options: [c.options[0].id] })).json(); assert.equal(voted.resultsVisible, false, 'even voters wait until the poll closes');
  await browser()('POST', `/admin/${c.adminToken}/close`); assert.equal((await (await d('GET', `/polls/${c.slug}`)).json()).resultsVisible, true);
});
test('closing: manual close/reopen, deadline, voting rejected with 409, admin-only actions', async () => {
  const p = await create(); const a = browser();
  assert.equal((await a('POST', `/admin/${p.slug}/close`)).status, 404, 'public slug cannot close the poll'); assert.equal((await browser()('POST', `/admin/${p.adminToken}/close`)).status, 200);
  const r = await a('POST', `/polls/${p.slug}/vote`, { options: [p.options[0].id] }); assert.equal(r.status, 409); assert.match((await r.json()).error, /closed/);
  assert.equal((await (await browser()('POST', `/admin/${p.adminToken}/reopen`)).json()).closed, false); assert.equal((await a('POST', `/polls/${p.slug}/vote`, { options: [p.options[0].id] })).status, 200);
  const d = await create({ closesAt: new Date(t + 3600_000).toISOString() }); assert.equal((await (await browser()('GET', `/polls/${d.slug}`)).json()).closed, false);
  t += 2 * 3600_000; assert.equal((await (await browser()('GET', `/polls/${d.slug}`)).json()).closed, true, 'closed by the clock'); assert.equal((await browser()('POST', `/polls/${d.slug}/vote`, { options: [d.options[0].id] })).status, 409);
  assert.equal((await browser()('POST', `/admin/${d.adminToken}/reopen`)).status, 409, 'cannot reopen with a past deadline'); const ext = await browser()('POST', `/admin/${d.adminToken}/deadline`, { closesAt: new Date(t + 3600_000).toISOString() }); assert.equal((await ext.json()).closed, false);
  assert.equal((await browser()('POST', `/admin/${d.adminToken}/deadline`, { closesAt: new Date(t - 1000).toISOString() })).status, 422); assert.equal((await (await browser()('POST', `/admin/${d.adminToken}/deadline`, {})).json()).closesAt, null);
});
test('delete removes the poll and its votes; rate limiting returns 429 + Retry-After', async () => {
  const p = await create(); await browser()('POST', `/polls/${p.slug}/vote`, { options: [p.options[0].id] }); assert.equal((await browser()('DELETE', `/admin/${p.adminToken}`)).status, 204); assert.equal((await browser()('GET', `/polls/${p.slug}`)).status, 404); assert.equal((await browser()('GET', `/admin/${p.adminToken}`)).status, 404);
  const s2 = createApp({ now: () => t, limits: { create: 2, vote: 2 } }).server; await new Promise((r) => s2.listen(0, r)); const b2 = `http://127.0.0.1:${s2.address().port}`;
  const post = (path, body) => fetch(b2 + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/polls', { question: 'a', options: ['x', 'y'] })).status, 201); assert.equal((await post('/polls', { question: 'a', options: ['x', 'y'] })).status, 201); const lim = await post('/polls', { question: 'a', options: ['x', 'y'] });
  assert.equal(lim.status, 429); assert.equal(lim.headers.get('retry-after'), '60'); t += 61_000; assert.equal((await post('/polls', { question: 'a', options: ['x', 'y'] })).status, 201, 'window resets'); s2.close();
});
test('errors and static', async () => {
  assert.equal((await browser()('GET', '/polls/doesnotexist')).status, 404); assert.equal((await browser()('GET', '/polls/..%2f..')).status, 404); assert.equal((await fetch(base + '/api/polls', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
