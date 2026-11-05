// Vehicle maths. Pure; shared by server and browser. Distances in whole km, volumes in millilitres, money in cents.
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
export const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
export function addMonths(d, n) { const [y, m, day] = d.split('-').map(Number), t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = (t % 12) + 1, dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate(); return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`; }
/**
 * Fuel economy from fill-ups [{ day, odometer, ml, full }] using the full-tank method: a trip is measured between two FULL fill-ups;
 * fuel added in between (partial fills) counts toward the later full fill-up. Fill-ups before the first full one only set the baseline.
 * Returns [{ day, km, ml, lPer100, kmPerL }] — one per full fill-up after the baseline.
 */
export function consumption(fills) {
  const s = [...fills].sort((a, b) => a.odometer - b.odometer || a.day.localeCompare(b.day)), out = []; let base = null, ml = 0;
  for (const f of s) {
    if (base) ml += f.ml;
    if (f.full) { if (base && f.odometer > base.odometer) { const km = f.odometer - base.odometer; out.push({ day: f.day, km, ml, lPer100: Math.round((ml / 10 / km) * 100) / 100, kmPerL: Math.round((km / (ml / 1000)) * 100) / 100 }); } base = f; ml = 0; }
  }
  return out;
}
/** Overall average over measured trips (distance-weighted): total fuel / total km. */
export function averageConsumption(trips) { const km = trips.reduce((a, t) => a + t.km, 0), ml = trips.reduce((a, t) => a + t.ml, 0); return km ? { lPer100: Math.round((ml / 10 / km) * 100) / 100, km, liters: Math.round(ml / 10) / 100 } : null; }
/** Cost per km in cents from fuel spend over the measured distance. */
export const costPerKm = (cents, km) => (km > 0 ? Math.round((cents / km) * 100) / 100 : null);
/**
 * Service status for a task { everyKm|null, everyMonths|null } given the last time it was done ({ odometer, day } or null → never)
 * and the car's current odometer and today. Due = whichever of the two limits comes first. status: ok | soon | overdue | never.
 * "soon" = within 10 % of the km interval or 14 days.
 */
export function serviceStatus(task, last, odometer, today) {
  if (!task.everyKm && !task.everyMonths) return { status: 'ok', dueKm: null, dueDay: null, kmLeft: null, daysLeft: null };
  if (!last) return { status: 'never', dueKm: null, dueDay: null, kmLeft: null, daysLeft: null };
  const dueKm = task.everyKm ? last.odometer + task.everyKm : null, dueDay = task.everyMonths ? addMonths(last.day, task.everyMonths) : null;
  const kmLeft = dueKm === null ? null : dueKm - odometer, daysLeft = dueDay === null ? null : dayNum(dueDay) - dayNum(today);
  const over = (kmLeft !== null && kmLeft < 0) || (daysLeft !== null && daysLeft < 0), soon = (kmLeft !== null && kmLeft <= task.everyKm * 0.1) || (daysLeft !== null && daysLeft <= 14);
  return { status: over ? 'overdue' : soon ? 'soon' : 'ok', dueKm, dueDay, kmLeft, daysLeft };
}
