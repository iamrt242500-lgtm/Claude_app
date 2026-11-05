// Plant care scheduling. Pure; shared by server and browser.
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
export const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
export const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
/** Meteorological season for a date; the southern hemisphere is flipped. */
export function season(date, south = false) { const m = Number(date.slice(5, 7)), s = m === 12 || m <= 2 ? 0 : m <= 5 ? 1 : m <= 8 ? 2 : 3; return SEASONS[south ? (s + 2) % 4 : s]; }
/** Default seasonal factors: water more often in summer, much less in winter (factor multiplies the base interval). */
export const DEFAULT_FACTORS = { winter: 1.75, spring: 1, summer: 0.75, autumn: 1.25 };
/** Effective interval in whole days for a given date (never below 1). */
export function interval(plant, date, south = false) { const f = plant.seasonal ? (DEFAULT_FACTORS[season(date, south)] ?? 1) : 1; return Math.max(1, Math.round(plant.everyDays * f)); }
/**
 * Next watering date: last watered + the interval that applies on the DUE day's season, found iteratively so a plant
 * watered on Nov 28 with a winter factor gets the winter interval. Never-watered plants are due on their start date.
 */
export function nextWatering(plant, south = false) {
  if (!plant.lastWatered) return plant.added; let due = addDays(plant.lastWatered, interval(plant, plant.lastWatered, south));
  due = addDays(plant.lastWatered, interval(plant, due, south)); return due;
}
/** status relative to today: 'overdue' (≥1 day late), 'today', 'soon' (≤2 days), 'ok'. Includes days late/left. */
export function dueStatus(plant, today, south = false) {
  const due = nextWatering(plant, south), diff = dayNum(due) - dayNum(today);
  return { due, daysLeft: diff, status: diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff <= 2 ? 'soon' : 'ok' };
}
/** How consistent the care has been: mean gap between waterings vs the plan, in days (positive = watered later than planned). */
export function adherence(waterings, plannedDays) {
  const d = [...waterings].sort(); if (d.length < 2) return null; const gaps = d.slice(1).map((x, i) => dayNum(x) - dayNum(d[i])), mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return { meanGap: Math.round(mean * 10) / 10, drift: Math.round((mean - plannedDays) * 10) / 10, longest: Math.max(...gaps) };
}
