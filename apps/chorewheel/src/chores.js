// Chore scheduling and fair assignment. Pure; shared by server and browser.
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
export const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
/** Due dates of a chore (start + k·every) within [from, to], inclusive. */
export function dueDates(chore, from, to) {
  const out = [], s = dayNum(chore.start), a = dayNum(from), b = dayNum(to); if (b < s || !(chore.every >= 1)) return out;
  let k = a > s ? Math.ceil((a - s) / chore.every) : 0; for (let d = s + k * chore.every; d <= b; d += chore.every) out.push(addDays(chore.start, d - s)); return out;
}
/**
 * Choose who does an instance. members: [{ id, awayUntil|null }]; load: Map id → points in the recent window (incl. already assigned);
 * lastDone: Map id → 'YYYY-MM-DD' of the last time that person did THIS chore (absent = never).
 * Rule: skip people away on the due day; lowest load wins; tie → who did this chore longest ago (never = oldest); tie → lowest id.
 * Returns the member id or null if everybody is away.
 */
export function pickAssignee(day, members, load, lastDone) {
  const ok = members.filter((m) => !m.awayUntil || m.awayUntil < day); if (!ok.length) return null;
  return [...ok].sort((x, y) => (load.get(x.id) || 0) - (load.get(y.id) || 0) || (lastDone.get(x.id) || '0000-00-00').localeCompare(lastDone.get(y.id) || '0000-00-00') || x.id - y.id)[0].id;
}
/** Fairness summary of per-person points: spread and each person's share of the total (0 total → equal shares). */
export function fairness(points) {
  const ids = Object.keys(points), vals = ids.map((i) => points[i]), total = vals.reduce((a, b) => a + b, 0), n = ids.length;
  return { total, spread: n ? Math.max(...vals) - Math.min(...vals) : 0, shares: Object.fromEntries(ids.map((i) => [i, total ? Math.round((points[i] / total) * 100) : n ? Math.round(100 / n) : 0])) };
}
