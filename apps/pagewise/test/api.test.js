import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
before(async () => { server = createApp({ now: () => new Date('2026-03-15T12:00:00Z') }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const log = (id, day, page) => call('PUT', `/books/${id}/log`, { day, page });

test('books: create, validate, patch, rating', async () => {
  const b = await call('POST', '/books', { title: ' Dune ', author: 'Frank Herbert', totalPages: 600 }); assert.equal(b.status, 201); const d = await b.json(); assert.deepEqual([d.title, d.status, d.page, d.percent, d.eta], ['Dune', 'to-read', 0, 0, null]);
  for (const [x, k] of [[{ title: '', totalPages: 10 }, 'title'], [{ title: 'x', totalPages: 0 }, 'totalPages'], [{ title: 'x', totalPages: 20001 }, 'totalPages'], [{ title: 'x', totalPages: 1.5 }, 'totalPages'], [{ title: 'x', totalPages: 10, rating: 6 }, 'rating'], [{ title: 'x', author: 'a'.repeat(81), totalPages: 10 }, 'author']]) { const r = await call('POST', '/books', x); assert.equal(r.status, 422, JSON.stringify(x)); assert.ok((await r.json()).details[k], k); }
  assert.equal((await J('PATCH', `/books/${d.id}`, { rating: 5 })).rating, 5);
});
test('logging pages: progress, rate, ETA, corrections, validation', async () => {
  const b = await J('POST', '/books', { title: 'Emma', totalPages: 300 }); await log(b.id, '2026-03-12', 60); await log(b.id, '2026-03-13', 90); const r = await (await log(b.id, '2026-03-15', 150)).json();
  assert.deepEqual([r.page, r.percent, r.status], [150, 50, 'reading']); assert.equal(r.pagesPerDay, Math.round((150 / 14) * 10) / 10); assert.equal(r.eta.days, 14); assert.equal(r.eta.date, '2026-03-29');
  const det = await J('GET', `/books/${b.id}`); assert.deepEqual(det.logs.map((l) => [l.day, l.pages]), [['2026-03-15', 60], ['2026-03-13', 30], ['2026-03-12', 60]]);
  assert.equal((await (await log(b.id, '2026-03-15', 140)).json()).page, 140, 'same day is replaced, not duplicated');
  for (const [day, page, k] of [['2026-03-16', 10, 'day'], ['2026-02-30', 10, 'day'], ['2026-03-14', 301, 'page'], ['2026-03-14', -1, 'page'], ['2026-03-14', 1.5, 'page']]) { const x = await log(b.id, day, page); assert.equal(x.status, 422, `${day} ${page}`); assert.ok((await x.json()).details[k], k); }
  assert.equal((await call('PUT', '/books/999/log', { page: 1 })).status, 404);
});
test('finishing: first day the last page is reached; undone by removing the log; page count cannot drop below logs', async () => {
  const b = await J('POST', '/books', { title: 'Short', totalPages: 100 }); await log(b.id, '2026-03-10', 40); const f = await (await log(b.id, '2026-03-14', 100)).json(); assert.deepEqual([f.status, f.finishedDay, f.eta], ['finished', '2026-03-14', null]); await log(b.id, '2026-03-15', 100);
  assert.equal((await J('GET', `/books/${b.id}`)).finishedDay, '2026-03-14', 'a later log at the end does not move the finish date');
  const sh = await call('PATCH', `/books/${b.id}`, { totalPages: 90 }); assert.equal(sh.status, 422); assert.match((await sh.json()).details.totalPages, /page 100 is already logged/);
  await call('DELETE', `/books/${b.id}/log/2026-03-15`); const del = await (await call('DELETE', `/books/${b.id}/log/2026-03-14`)).json(); assert.deepEqual([del.status, del.finishedDay], ['reading', null]); assert.equal((await call('DELETE', `/books/${b.id}/log/2026-03-14`)).status, 404);
  const bigger = await J('PATCH', `/books/${b.id}`, { totalPages: 120 }); assert.equal(bigger.percent, 33);
});
test('stats: 30-day series, rate, streaks, year totals and goal pace', async () => {
  const s = await J('GET', '/stats'); assert.equal(s.series.length, 30); assert.equal(s.series.at(-1).day, '2026-03-15'); assert.equal(s.series.at(0).day, '2026-02-14'); assert.equal(s.series.find((x) => x.day === '2026-03-13').pages, 30, 'Emma went from page 60 to 90 on 03-13');
  assert.equal(s.streak >= 1, true); assert.equal(s.goal, 12); assert.equal(s.pace.dayOfYear, 74); assert.equal(s.pace.daysInYear, 365); assert.equal(s.pace.expected, 2.4); assert.equal(s.finishedThisYear, 0); assert.equal(s.pace.status, 'behind');
  const done = await J('POST', '/books', { title: 'Done', totalPages: 10 }); await log(done.id, '2026-03-01', 10); const s2 = await J('GET', '/stats'); assert.equal(s2.finishedThisYear, 1); assert.equal(s2.pace.status, 'behind'); assert.equal(s2.pace.diff, -1.4);
  const g = await J('PUT', '/goal', { goal: 2 }); assert.equal(g.pace.status, 'ahead'); for (const bad of [0, 1001, 1.5, '3']) assert.equal((await call('PUT', '/goal', { goal: bad })).status, 422, String(bad));
});
test('delete cascades; client date; errors', async () => {
  const b = await J('POST', '/books', { title: 'Gone', totalPages: 10 }); await log(b.id, '2026-03-15', 5); assert.equal((await call('DELETE', `/books/${b.id}`)).status, 204); assert.equal((await call('GET', `/books/${b.id}`)).status, 404);
  assert.equal((await J('GET', '/stats?today=2026-03-16')).today, '2026-03-16'); assert.equal((await J('GET', '/stats?today=2030-01-01')).today, '2026-03-15'); assert.equal((await call('GET', '/books/zz')).status, 400);
  assert.equal((await fetch(base + '/api/books', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
