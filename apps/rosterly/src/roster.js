// Shift scheduling rules. Pure; shared by server and browser.
// A shift is { day: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' }; end <= start means it runs past midnight into the next day.
export const toMin = (t) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const dayNumber = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
export const addDays = (d, n) => new Date((dayNumber(d) + n) * 86400000).toISOString().slice(0, 10);
/** Absolute [start, end) in minutes since the epoch day 0, or null if invalid. Overnight shifts end the next day. A shift is never longer than 16 h. */
export function span(s) {
  const a = toMin(s.start), b = toMin(s.end); if (a === null || b === null || !isDate(s.day) || a === b) return null;
  const base = dayNumber(s.day) * 1440, start = base + a, end = base + (b > a ? b : b + 1440); return end - start > 16 * 60 ? null : { start, end };
}
export const hours = (s) => { const x = span(s); return x ? (x.end - x.start) / 60 : 0; };
export const overlaps = (a, b) => { const x = span(a), y = span(b); return !!(x && y && x.start < y.end && y.start < x.end); };
/** Monday of the week containing `day`. */
export function weekStart(day) { const dow = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7; return addDays(day, -dow); }

/**
 * Problems for assigning `candidate` to a person who already has `existing` shifts.
 * rules: { maxWeeklyHours, minRestHours, unavailable: [{ weekday 0-6 (0=Sun) }] , timeOff: ['YYYY-MM-DD'] }
 * Returns [{ code, message }] — empty means fine.
 */
export function problems(candidate, existing, rules = {}) {
  const out = [], c = span(candidate); if (!c) return [{ code: 'invalid', message: 'Invalid shift times' }];
  const others = existing.filter((s) => span(s));
  const clash = others.find((s) => overlaps(candidate, s)); if (clash) out.push({ code: 'overlap', message: `Overlaps another shift (${clash.day} ${clash.start}–${clash.end})` });
  const minRest = (rules.minRestHours ?? 0) * 60;
  if (minRest > 0) for (const s of others) { const o = span(s); const gap = o.end <= c.start ? c.start - o.end : c.end <= o.start ? o.start - c.end : null; if (gap !== null && gap < minRest) { out.push({ code: 'rest', message: `Only ${(gap / 60).toFixed(1)} h rest next to the shift on ${s.day} (minimum ${rules.minRestHours} h)` }); break; } }
  if (rules.maxWeeklyHours != null) { const wk = weekStart(candidate.day), total = others.filter((s) => weekStart(s.day) === wk && !overlaps(candidate, s)).reduce((a, s) => a + hours(s), 0) + hours(candidate); if (total > rules.maxWeeklyHours + 1e-9) out.push({ code: 'weekly', message: `Would reach ${+total.toFixed(2)} h this week (max ${rules.maxWeeklyHours} h)` }); }
  const days = [candidate.day]; if (c.end > (dayNumber(candidate.day) + 1) * 1440) days.push(addDays(candidate.day, 1));
  if ((rules.timeOff || []).some((d) => days.includes(d))) out.push({ code: 'timeoff', message: 'Has approved time off' });
  const wds = new Set((rules.unavailable || []).map((u) => u.weekday)); if (days.some((d) => wds.has(new Date(d + 'T00:00:00Z').getUTCDay()))) out.push({ code: 'unavailable', message: 'Marked unavailable on this weekday' });
  return out;
}
/** Hours per person for a list of shifts, rounded to quarter hours. */
export function totals(shifts) { const t = {}; for (const s of shifts) t[s.personId] = (t[s.personId] || 0) + hours(s); return t; }
/** Coverage per hour-of-day for one day: how many people are on at each hour (0-23). Overnight shifts from the previous day count in the morning. */
export function coverage(shifts, day) {
  const out = Array(24).fill(0), d0 = dayNumber(day) * 1440;
  for (const s of shifts) { const x = span(s); if (!x) continue; for (let h = 0; h < 24; h++) { const a = d0 + h * 60, b = a + 60; if (x.start < b && x.end > a) out[h]++; } }
  return out;
}
