// Reading statistics. Pure; shared by server and browser.
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
export const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/**
 * Pages read per day from one book's page log [{ day, page }] (any order; one log per day).
 * pages on a day = page − the previous logged page (first log counts from 0); a lower page is a correction and counts as 0.
 */
export function pagesPerDay(logs) {
  const s = [...logs].sort((a, b) => a.day.localeCompare(b.day)), out = new Map(); let prev = 0;
  for (const l of s) { out.set(l.day, Math.max(0, l.page - prev)); prev = l.page; } return out;
}
/** Combine several books' per-day maps. */
export function mergeDays(maps) { const out = new Map(); for (const m of maps) for (const [d, n] of m) out.set(d, (out.get(d) || 0) + n); return out; }
/** Average pages/day over the `window` days ending on `asOf` (zero-read days count). */
export function rate(perDay, asOf, window = 14) { let sum = 0; for (let i = 0; i < window; i++) sum += perDay.get(addDays(asOf, -i)) || 0; return sum / window; }
/** Projected finish (the -1e-9 tolerates float noise: 150 / (150/14) is 14.000000000000002): { days, date } or null when the rate is 0 or the book is finished. */
export function eta(remaining, pagesPerDayRate, asOf) { if (remaining <= 0 || !(pagesPerDayRate > 0)) return null; const days = Math.ceil(remaining / pagesPerDayRate - 1e-9); return { days, date: addDays(asOf, days) }; }
/** Current reading streak: consecutive days with at least one page, ending today, or yesterday if today has nothing yet. */
export function streak(perDay, today) { let d = (perDay.get(today) || 0) > 0 ? today : addDays(today, -1), n = 0; while ((perDay.get(d) || 0) > 0) { n++; d = addDays(d, -1); } return n; }
export function longestStreak(perDay) { const days = [...perDay].filter(([, n]) => n > 0).map(([d]) => d).sort(); let best = 0, run = 0, prev = null; for (const d of days) { run = prev && dayNum(d) === dayNum(prev) + 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; } return best; }
/** Yearly goal pacing. `finishedThisYear` books vs the share of the year elapsed (today inclusive). */
export function goalPace(goal, finishedThisYear, today) {
  const y = Number(today.slice(0, 4)), total = isLeap(y) ? 366 : 365, doy = dayNum(today) - dayNum(`${y}-01-01`) + 1, expected = (goal * doy) / total, diff = finishedThisYear - expected;
  return { expected: Math.round(expected * 10) / 10, diff: Math.round(diff * 10) / 10, status: Math.abs(diff) < 0.5 ? 'on track' : diff > 0 ? 'ahead' : 'behind', dayOfYear: doy, daysInYear: total, booksPerMonthNeeded: goal > finishedThisYear ? Math.round(((goal - finishedThisYear) / Math.max(1, (total - doy) / (total / 12))) * 10) / 10 : 0 };
}
