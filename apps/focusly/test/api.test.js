import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, t = Date.parse('2026-03-10T09:00:00Z');
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ now: () => t }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const start = (b) => call('POST', '/sessions/start', b);

test('start a focus session; state reports remaining time; second start is rejected', async () => {
  const r = await start({ kind: 'focus', minutes: 25, label: ' Deep work ' }); assert.equal(r.status, 201);
  const s = await r.json(); assert.equal(s.active.label, 'Deep work'); assert.equal(s.active.endsAt - s.active.startedAt, 25 * 60000); assert.equal(s.now, t);
  const again = await start({ kind: 'short', minutes: 5 }); assert.equal(again.status, 409);
});
test('time passes: session auto-completes with finishedAt = endsAt, counted in stats', async () => {
  t += 10 * 60000; let s = await (await call('GET', '/state')).json(); assert.equal(s.active.status, 'active'); assert.equal(s.stats.todayMinutes, 0);
  t += 20 * 60000; s = await (await call('GET', '/state')).json(); assert.equal(s.active, null, 'completed lazily without any client being open');
  assert.equal(s.stats.todayMinutes, 25); assert.equal(s.stats.todaySessions, 1); assert.equal(s.stats.streak, 1); assert.equal(s.history[0].status, 'completed'); assert.equal(s.history[0].finishedAt, s.history[0].endsAt); assert.deepEqual(s.labels, ['Deep work']);
});
test('stopping early cancels and does not count; stop with nothing active is 409', async () => {
  await start({ kind: 'focus', minutes: 50 }); t += 5 * 60000;
  const s = await (await call('POST', '/sessions/stop')).json(); assert.equal(s.active, null); assert.equal(s.history[0].status, 'cancelled'); assert.equal(s.stats.todayMinutes, 25);
  assert.equal((await call('POST', '/sessions/stop')).status, 409);
});
test('stop after time is up counts as completed (no lost sessions)', async () => {
  await start({ kind: 'focus', minutes: 1 }); t += 90_000; const s = await (await call('POST', '/sessions/stop')).json().catch(() => null);
  const st = await (await call('GET', '/state')).json(); assert.equal(st.history[0].status, 'completed'); assert.equal(st.stats.todayMinutes, 26); void s;
});
test('breaks do not count as focus; validation', async () => {
  await start({ kind: 'short', minutes: 5 }); t += 6 * 60000; assert.equal((await (await call('GET', '/state')).json()).stats.todayMinutes, 26);
  for (const [b, key] of [[{ kind: 'nap', minutes: 5 }, 'kind'], [{ kind: 'focus', minutes: 0 }, 'minutes'], [{ kind: 'focus', minutes: 181 }, 'minutes'], [{ kind: 'focus', minutes: 2.5 }, 'minutes'], [{ kind: 'short', minutes: '5' }, 'minutes'], [{ kind: 'short', minutes: 61 }, 'minutes'], [{ kind: 'focus', minutes: 25, label: 'x'.repeat(61) }, 'label']]) {
    const r = await start(b); assert.equal(r.status, 422); assert.ok((await r.json()).details[key], JSON.stringify(b));
  }
});
test('timezone: tz offset decides which local day a session belongs to; bad tz ignored', async () => {
  t = Date.parse('2026-03-10T12:00:00Z');   // 12:00Z is already 02:00 on the 11th in UTC+14
  const utc = await (await call('GET', '/state')).json(), tokyo = await (await call('GET', '/state?tz=-840')).json();
  assert.equal(utc.stats.today, '2026-03-10'); assert.equal(tokyo.stats.today, '2026-03-11'); assert.equal(tokyo.stats.todayMinutes, 0);
  assert.equal((await (await call('GET', '/state?tz=9999')).json()).stats.today, '2026-03-10'); assert.equal((await (await call('GET', '/state?tz=abc')).json()).stats.today, '2026-03-10');
});
test('delete history entries; active cannot be deleted; errors; static; shared module served', async () => {
  const st = await (await call('GET', '/state')).json(); const id = st.history[0].id; assert.equal((await call('DELETE', `/sessions/${id}`)).status, 200); assert.equal((await call('DELETE', `/sessions/${id}`)).status, 404);
  await start({ kind: 'focus', minutes: 25 }); const active = (await (await call('GET', '/state')).json()).active; assert.equal((await call('DELETE', `/sessions/${active.id}`)).status, 404); await call('POST', '/sessions/stop');
  assert.equal((await call('DELETE', '/sessions/abc')).status, 400); assert.equal((await fetch(base + '/api/sessions/start', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  const m = await fetch(base + '/timer.js'); assert.equal(m.status, 200); assert.match(m.headers.get('content-type'), /javascript/); assert.match(await m.text(), /export function formatClock/);
});
