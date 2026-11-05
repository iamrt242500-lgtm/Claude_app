// Subscription date and cost maths. Pure; shared by server and browser. Money = integer cents.
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
export const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m = 1..12
export const UNITS = ['week', 'month', 'year'];
/** The k-th occurrence (k ≥ 0) of a cycle anchored at `start`. Months/years clamp to the month end but always anchor to the ORIGINAL day (Jan 31 → Feb 28 → Mar 31). */
export function occurrence(start, unit, every, k) {
  if (unit === 'week') return addDays(start, 7 * every * k);
  const [y, m, d] = start.split('-').map(Number), total = (y * 12 + (m - 1)) + (unit === 'year' ? 12 : 1) * every * k, ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(d, daysInMonth(ny, nm))).padStart(2, '0')}`;
}
/** First occurrence on or after `asOf` (null if the cycle is invalid). */
export function nextRenewal(start, unit, every, asOf) {
  if (!UNITS.includes(unit) || !(every >= 1)) return null; if (asOf <= start) return start;
  let k = Math.max(0, Math.floor(((dayNum(asOf) - dayNum(start)) / (unit === 'week' ? 7 * every : (unit === 'month' ? 28 : 365) * every)) - 1)); while (occurrence(start, unit, every, k) < asOf) k++; return occurrence(start, unit, every, k);
}
/** All occurrences within [from, to] inclusive. */
export function occurrencesBetween(start, unit, every, from, to) { const out = []; let d = nextRenewal(start, unit, every, from < start ? start : from), k = 0; if (!d) return out; while (d && d <= to) { out.push(d); k = 1; d = nextRenewal(start, unit, every, addDays(d, 1)); if (k > 1000) break; } return out; }
/** Monthly equivalent in cents (rounded half up): week → ×52/12, year → ÷12. */
export function monthlyCost(price, unit, every) { const m = unit === 'week' ? (price * 52) / (12 * every) : unit === 'month' ? price / every : price / (12 * every); return Math.round(m); }
export const yearlyCost = (price, unit, every) => Math.round(unit === 'week' ? (price * 52) / every : unit === 'month' ? (price * 12) / every : price / every);
export const daysUntil = (date, asOf) => dayNum(date) - dayNum(asOf);
export const formatMoney = (c) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100).toLocaleString('en-US')}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
export const parseMoney = (x) => { if (typeof x !== 'string') return null; const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(x.trim().replace(/^\$/, '').replace(/,/g, '')); return m ? Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0) : null; };
