import test from 'node:test';
import assert from 'node:assert/strict';
import { remainingMs, formatClock, dayKey, addDays, streak, summarize, validTz } from '../src/timer.js';

test('formatClock rounds up so 0:00 only appears when truly done', () => {
  assert.equal(formatClock(25 * 60000), '25:00'); assert.equal(formatClock(59001), '01:00'); assert.equal(formatClock(1), '00:01'); assert.equal(formatClock(0), '00:00'); assert.equal(formatClock(-5), '00:00'); assert.equal(formatClock(90 * 60000), '90:00');
});
test('remainingMs never negative', () => { assert.equal(remainingMs(1000, 400), 600); assert.equal(remainingMs(1000, 5000), 0); });
test('dayKey applies the user timezone offset (getTimezoneOffset semantics)', () => {
  const t = Date.parse('2026-03-10T23:30:00Z');
  assert.equal(dayKey(t, 0), '2026-03-10'); assert.equal(dayKey(t, -540), '2026-03-11', 'UTC+9 is already the next day'); assert.equal(dayKey(t, 300), '2026-03-10', 'UTC-5'); assert.equal(dayKey(Date.parse('2026-03-10T02:00:00Z'), 300), '2026-03-09');
  assert.ok(validTz(-540) && validTz(0) && !validTz(900) && !validTz(1.5) && !validTz('0'));
});
test('streak: grace for today, breaks on gaps', () => {
  const S = (...d) => new Set(d);
  assert.equal(streak(S('2026-03-08', '2026-03-09', '2026-03-10'), '2026-03-10'), 3); assert.equal(streak(S('2026-03-08', '2026-03-09'), '2026-03-10'), 2, 'today empty is not a break');
  assert.equal(streak(S('2026-03-07', '2026-03-10'), '2026-03-10'), 1); assert.equal(streak(S('2026-03-07'), '2026-03-10'), 0); assert.equal(streak(S(), '2026-03-10'), 0);
  assert.equal(streak(S('2025-12-31', '2026-01-01'), '2026-01-01'), 2, 'year boundary');
});
test('summarize counts only completed focus sessions, groups by local day and label', () => {
  const now = Date.parse('2026-03-10T12:00:00Z'), f = (iso) => Date.parse(iso);
  const s = [{ kind: 'focus', label: 'Write', minutes: 25, status: 'completed', finishedAt: f('2026-03-10T09:00:00Z') }, { kind: 'focus', label: 'Write', minutes: 25, status: 'completed', finishedAt: f('2026-03-09T09:00:00Z') },
    { kind: 'focus', label: '', minutes: 50, status: 'completed', finishedAt: f('2026-03-10T10:00:00Z') }, { kind: 'focus', label: 'X', minutes: 25, status: 'cancelled', finishedAt: f('2026-03-10T10:30:00Z') }, { kind: 'short', label: '', minutes: 5, status: 'completed', finishedAt: f('2026-03-10T11:00:00Z') }];
  const r = summarize(s, now, 0); assert.equal(r.todayMinutes, 75); assert.equal(r.todaySessions, 2); assert.equal(r.streak, 2); assert.equal(r.totalMinutes, 100); assert.equal(r.days.length, 14); assert.equal(r.days.at(-1).minutes, 75); assert.equal(r.days.at(-2).minutes, 25);
  assert.deepEqual(r.labels, [{ label: '(no label)', minutes: 50 }, { label: 'Write', minutes: 50 }]);
  assert.equal(summarize(s, now, -840).todayMinutes, 50, 'in UTC+14 "today" is the 11th and only the 10:00Z session (00:00 local) falls on it');
  assert.equal(summarize(s, now, 0).days.at(-1).day, '2026-03-10'); assert.equal(summarize(s, now, -840).days.at(-1).day, '2026-03-11');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
