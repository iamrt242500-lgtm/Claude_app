// Sprint burndown maths. Pure; shared by server and browser. Working days are Monday–Friday.
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
export const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
export const isWorkday = (d) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w !== 0 && w !== 6; };
export const workingDays = (start, end) => { const out = []; for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkday(d)) out.push(d); return out; };
export const nextWorkday = (d) => { let n = addDays(d, 1); while (!isWorkday(n)) n = addDays(n, 1); return n; };
/** Add `n` working days to `from` (n ≥ 0; from itself need not be a workday). */
export const addWorkdays = (from, n) => { let d = from; for (let i = 0; i < n; i++) d = nextWorkday(d); return d; };
/**
 * Ideal burndown: remaining points at the END of each working day if work finishes evenly. Returns [{ day, ideal }] plus the starting total.
 * scope = points committed at the start.
 */
export function ideal(scope, days) { const n = days.length; return days.map((day, i) => ({ day, ideal: n ? Math.round(((scope * (n - 1 - i)) / n) * 100) / 100 : scope })); }
/** Remaining points at the end of `day`: tasks added by then and not done by then. tasks: [{ points, addedDay, doneDay|null }] */
export const remainingAt = (tasks, day) => tasks.filter((t) => t.addedDay <= day && (!t.doneDay || t.doneDay > day)).reduce((s, t) => s + t.points, 0);
/** Actual burndown for every working day up to and including `upTo`. */
export function actual(tasks, days, upTo) { return days.filter((d) => d <= upTo).map((day) => ({ day, remaining: remainingAt(tasks, day) })); }
/**
 * Forecast from velocity (points completed per elapsed working day). Returns { velocity, workdaysLeft, finish, status }.
 * status compares actual remaining today with the ideal line: ahead (≥ 0.5 pt under), behind (≥ 0.5 pt over) or on track.
 */
export function forecast(tasks, start, end, today) {
  const days = workingDays(start, end), elapsedDays = days.filter((d) => d <= today), scope = tasks.filter((t) => t.addedDay <= start).reduce((s, t) => s + t.points, 0);
  const rem = remainingAt(tasks, today < start ? start : today > end ? end : today), done = tasks.filter((t) => t.doneDay && t.doneDay <= today).reduce((s, t) => s + t.points, 0), el = elapsedDays.length, vel = el ? done / el : 0;
  const idl = days.length && el ? ideal(scope, days)[Math.min(el, days.length) - 1].ideal : scope, diff = rem - idl;
  const wl = vel > 0 && rem > 0 ? Math.ceil(rem / vel - 1e-9) : null;
  return { scope, remaining: rem, done, velocity: Math.round(vel * 100) / 100, elapsedWorkdays: el, totalWorkdays: days.length, ideal: idl, status: today < start ? 'not started' : rem === 0 && tasks.length ? 'complete' : Math.abs(diff) < 0.5 ? 'on track' : diff < 0 ? 'ahead' : 'behind', workdaysLeft: wl, finish: wl === null ? null : addWorkdays(today < start ? start : today, wl), finishesInSprint: wl === null ? rem === 0 : addWorkdays(today < start ? start : today, wl) <= end };
}
