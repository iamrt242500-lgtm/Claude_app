import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, normTags } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ now: () => new Date('2026-03-31T12:00:00Z') }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test('normTags', () => {
  assert.deepEqual(normTags(['#Run', 'run', ' Late Night ']), ['run', 'late-night']); assert.deepEqual(normTags('a, b,,c'), ['a', 'b', 'c']); assert.deepEqual(normTags(undefined), []);
  assert.equal(normTags(['bad!']), null); assert.equal(normTags([1]), null); assert.equal(normTags(Array.from({ length: 9 }, (_, i) => 't' + i)), null); assert.equal(normTags(['x'.repeat(21)]), null);
});
test('PUT creates (201) then updates (200); GET/DELETE', async () => {
  const a = await call('PUT', '/entries/2026-03-30', { mood: 4, energy: 3, sleep: 7.5, note: ' good day ', tags: ['Run'] }); assert.equal(a.status, 201); assert.deepEqual(await a.json(), { day: '2026-03-30', mood: 4, energy: 3, sleep: 7.5, note: 'good day', tags: ['run'] });
  const b = await call('PUT', '/entries/2026-03-30', { mood: 2, energy: 2 }); assert.equal(b.status, 200); const j = await b.json(); assert.equal(j.mood, 2); assert.equal(j.sleep, null); assert.deepEqual(j.tags, []);
  assert.equal((await (await call('GET', '/entries/2026-03-30')).json()).mood, 2); assert.equal((await call('DELETE', '/entries/2026-03-30')).status, 204); assert.equal((await call('GET', '/entries/2026-03-30')).status, 404); assert.equal((await call('DELETE', '/entries/2026-03-30')).status, 404);
});
test('validation: every field, future days, bad dates', async () => {
  const bad = await call('PUT', '/entries/2026-04-02', { mood: 6, energy: 1.5, sleep: 30, note: 'x'.repeat(501), tags: ['bad!'] }); assert.equal(bad.status, 422); assert.deepEqual(Object.keys((await bad.json()).details).sort(), ['day', 'energy', 'mood', 'note', 'sleep', 'tags']);
  assert.equal((await call('PUT', '/entries/2026-02-30', { mood: 3, energy: 3 })).status, 400); assert.equal((await call('PUT', '/entries/2026-04-01', { mood: 3, energy: 3 })).status, 422, 'tomorrow UTC is future'); assert.equal((await call('PUT', '/entries/2026-03-31?today=2026-04-01', { mood: 3, energy: 3 })).status, 201, 'client may be a day ahead (time zones)');
  assert.equal((await call('PUT', '/entries/2026-03-29', { mood: '4', energy: 3 })).status, 422, 'mood must be a number');
  await call('DELETE', '/entries/2026-03-31'); assert.equal((await call('GET', '/entries?from=nope')).status, 400);
});
test('list: range filter, newest first', async () => {
  for (const [d, m] of [['2026-03-01', 3], ['2026-03-02', 4], ['2026-03-03', 5]]) await call('PUT', `/entries/${d}`, { mood: m, energy: 3 });
  assert.deepEqual((await (await call('GET', '/entries?from=2026-03-02&to=2026-03-03')).json()).map((e) => e.day), ['2026-03-03', '2026-03-02']);
});
test('insights: window, averages, correlations, tag effects, weekday, streak', async () => {
  // 14 more days of data: run-days are happier and sleep tracks mood perfectly
  for (let i = 0; i < 14; i++) { const day = `2026-03-${String(15 + i).padStart(2, '0')}`, run = i % 2 === 0, mood = run ? 5 : 2 + (i % 3 === 0 ? 1 : 0); await call('PUT', `/entries/${day}`, { mood, energy: mood, sleep: 4 + mood, tags: run ? ['run'] : [] }); }
  const r = await (await call('GET', '/insights?days=30')).json(); assert.equal(r.from, '2026-03-02'); assert.equal(r.to, '2026-03-31'); assert.equal(r.series.length, 30); assert.equal(r.logged, 16, '03-02, 03-03 and 03-15..03-28 (03-01 is outside the window)');
  assert.equal(r.avgMood, 3.75); assert.equal(r.series.find((x) => x.day === '2026-03-10').mood, null, 'unlogged days are gaps, not zeros');
  assert.deepEqual(r.correlations.sleepMood, { r: 1, n: 14, label: 'strong positive link' }); assert.equal(r.correlations.energyMood.label, 'strong positive link');
  assert.deepEqual(r.tagEffects, [{ tag: 'run', days: 7, withTag: 5, without: 2.78, diff: 2.22 }]);
  assert.equal(r.weekday.length, 7); assert.equal(r.weekday.reduce((a, w) => a + w.n, 0), 16); assert.equal(r.streak, 0, 'nothing logged on 03-31 or 03-30');
  await call('PUT', '/entries/2026-03-31', { mood: 3, energy: 3 }); await call('PUT', '/entries/2026-03-30', { mood: 3, energy: 3 }); await call('PUT', '/entries/2026-03-29', { mood: 3, energy: 3 }); assert.equal((await (await call('GET', '/insights?days=7')).json()).streak, 17, '03-29..03-31 plus 03-15..03-28 are consecutive');
});
test('insights: window validation and averages with no data', async () => {
  for (const d of ['3', '400', 'x', '7.5']) assert.equal((await call('GET', '/insights?days=' + d)).status, 422, d);
  const e = createApp({ now: () => new Date('2026-03-31T12:00:00Z') }); await new Promise((r) => e.server.listen(0, r)); const j = await (await fetch(`http://127.0.0.1:${e.server.address().port}/api/insights?days=14`)).json(); e.server.close();
  assert.equal(j.logged, 0); assert.equal(j.avgMood, null); assert.equal(j.correlations.sleepMood.r, null); assert.equal(j.correlations.sleepMood.label, 'not enough data'); assert.deepEqual(j.tagEffects, []); assert.equal(j.streak, 0);
});
test('errors and static', async () => {
  assert.equal((await fetch(base + '/api/entries/2026-03-01', { method: 'PUT', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.equal((await fetch(base + '/api/nope')).status, 404);
});
