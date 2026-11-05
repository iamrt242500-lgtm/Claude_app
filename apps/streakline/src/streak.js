// Streak math. All dates are 'YYYY-MM-DD' strings; weekday 0=Sun..6=Sat.
export const isDate = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const weekday = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
export const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** Current streak: consecutive scheduled days completed, ending today (today is a grace day if not yet done). */
export function currentStreak(schedule, done, start, today) {
  const sched = new Set(schedule); let n = 0;
  for (let d = today; d >= start; d = addDays(d, -1)) {
    if (!sched.has(weekday(d))) continue;
    if (done.has(d)) n++; else if (d === today) continue; else break;
  }
  return n;
}
export function longestStreak(schedule, done, start, today) {
  const sched = new Set(schedule); let best = 0, run = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    if (!sched.has(weekday(d))) continue;
    if (done.has(d)) { run++; best = Math.max(best, run); } else if (d !== today) run = 0;
  }
  return best;
}
/** Completion rate over the last `days` days (only scheduled days counted, and only since `start`). null if none. */
export function completionRate(schedule, done, start, today, days = 30) {
  const sched = new Set(schedule); let due = 0, hit = 0;
  const from = addDays(today, -(days - 1));
  for (let d = from < start ? start : from; d <= today; d = addDays(d, 1)) {
    if (!sched.has(weekday(d))) continue;
    if (d === today && !done.has(d)) continue;           // today is not a miss yet
    due++; if (done.has(d)) hit++;
  }
  return due ? Math.round((hit / due) * 100) : null;
}
export function normalizeSchedule(v) {
  const arr = Array.isArray(v) ? v : [];
  const out = [...new Set(arr.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort((a, b) => a - b);
  return out.length === arr.length && out.length ? out : null;
}
