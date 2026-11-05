// Running pace maths. Pure; shared by server and browser. Distances in metres, times in seconds.
export const KM = 1000, MILE = 1609.344;
const RACES = { '5k': 5000, '10k': 10000, 'half': 21097.5, 'half marathon': 21097.5, 'marathon': 42195, 'mile': MILE, '1500': 1500, '3000': 3000 };

/** "1:45:30", "25:10", "25:10.5", "90s", "45m", "1h30m", "1h 5m 3s" → seconds, or null. */
export function parseTime(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null;
  if (typeof input !== 'string') return null; const s = input.trim().toLowerCase(); let m;
  if ((m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s))) { const h = Number(m[1] || 0), mi = Number(m[2]), se = Number(m[3]); if (mi > 59 || se >= 60 || (!m[1] && mi > 599)) return null; const t = h * 3600 + mi * 60 + se; return t > 0 ? t : null; }
  if ((m = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec)?)?$/.exec(s)) && (m[1] || m[2] || m[3])) { const t = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0); return t > 0 && t < 1e6 ? t : null; }
  return null;
}
export function formatTime(sec, decimals = 0) {
  if (!Number.isFinite(sec)) return '—'; const f = 10 ** decimals; let t = Math.round(sec * f) / f; const h = Math.floor(t / 3600); t -= h * 3600; const m = Math.floor(t / 60); const s = t - m * 60;
  const ss = decimals ? s.toFixed(decimals).padStart(3 + decimals, '0') : String(Math.round(s)).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
/** "10k", "5 km", "6.2 mi", "half", "marathon", "800m", "10" (km) → metres, or null. */
export function parseDistance(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null; if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase().replace(/\s+/g, ' '); if (RACES[s]) return RACES[s];
  const m = /^(\d+(?:[.,]\d+)?)\s*(km|k|kilometers?|kilometres?|mi|miles?|m|meters?|metres?)?$/.exec(s); if (!m) return null; const v = Number(m[1].replace(',', '.')), u = m[2] || 'km';
  const d = /^(km|k|kilo)/.test(u) ? v * KM : /^mi/.test(u) ? v * MILE : v; return d > 0 && d <= 1e6 ? d : null;
}
export const paceSec = (distM, timeS, unit = 'km') => timeS / (distM / (unit === 'mi' ? MILE : KM));
export const speedKmh = (distM, timeS) => (distM / KM) / (timeS / 3600);
/** Given any two of {distance(m), time(s), pace(s per unit)} → all three. */
export function solve({ distance, time, pace }, unit = 'km') {
  const u = unit === 'mi' ? MILE : KM, have = [distance, time, pace].filter((x) => x != null).length; if (have !== 2) return null;
  if (distance == null) distance = (time / pace) * u; else if (time == null) time = (distance / u) * pace; else pace = time / (distance / u);
  return { distance, time, pace, speed: speedKmh(distance, time) };
}
/** Riegel: T2 = T1 · (D2/D1)^1.06 */
export const riegel = (t1, d1, d2, k = 1.06) => t1 * (d2 / d1) ** k;
/** Per-unit splits. `negative` = % faster second half (0 = even). Last split may be partial. Totals match `time` exactly. */
export function splits(distM, timeS, unit = 'km', negative = 0) {
  const u = unit === 'mi' ? MILE : KM, n = Math.ceil(distM / u - 1e-9), avg = timeS / (distM / u), out = [];
  // weight per split: linear ramp so the 2nd half averages `negative`% faster than the 1st
  const w = Array.from({ length: n }, (_, i) => { const len = Math.min(u, distM - i * u) / u; const x = n > 1 ? i / (n - 1) - 0.5 : 0; return { len, f: 1 - (negative / 100) * x * 2 }; });
  const total = w.reduce((a, b) => a + b.len * b.f, 0); let acc = 0;
  w.forEach((s, i) => { const t = (s.len * s.f / total) * timeS; acc += t; out.push({ n: i + 1, dist: Math.min(u, distM - i * u), split: t, pace: t / s.len, cumulative: i === n - 1 ? timeS : acc }); });
  return { avgPace: avg, splits: out };
}
