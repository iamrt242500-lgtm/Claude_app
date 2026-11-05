// Pure time/stat helpers (shared by server and browser). Times are epoch milliseconds.
export const KINDS = { focus: { min: 1, max: 180 }, short: { min: 1, max: 60 }, long: { min: 1, max: 120 } };
export const remainingMs = (endsAt, now) => Math.max(0, endsAt - now);
export function formatClock(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000), m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export const validTz = (v) => Number.isInteger(v) && v >= -840 && v <= 840;   // minutes behind UTC (JS getTimezoneOffset semantics)
/** Local calendar day for a timestamp. tz = Date.getTimezoneOffset() of the user (minutes; UTC+9 → -540). */
export const dayKey = (ts, tz = 0) => new Date(ts - tz * 60000).toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Consecutive days with focus, ending today — or yesterday if today has none yet (grace day). */
export function streak(days, today) {
  let d = days.has(today) ? today : addDays(today, -1), n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
/** sessions: [{kind,label,minutes,status,finishedAt}] ; only completed focus sessions count. */
export function summarize(sessions, now, tz = 0, span = 14) {
  const today = dayKey(now, tz), focus = sessions.filter((s) => s.kind === 'focus' && s.status === 'completed');
  const perDay = new Map(), perLabel = new Map();
  for (const s of focus) { const k = dayKey(s.finishedAt, tz); perDay.set(k, (perDay.get(k) || 0) + s.minutes); const l = s.label || '(no label)'; perLabel.set(l, (perLabel.get(l) || 0) + s.minutes); }
  const days = Array.from({ length: span }, (_, i) => { const d = addDays(today, i - (span - 1)); return { day: d, minutes: perDay.get(d) || 0 }; });
  return { today, todayMinutes: perDay.get(today) || 0, todaySessions: focus.filter((s) => dayKey(s.finishedAt, tz) === today).length, streak: streak(new Set(perDay.keys()), today), totalMinutes: focus.reduce((s, x) => s + x.minutes, 0), days,
    labels: [...perLabel.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([label, minutes]) => ({ label, minutes })) };
}
