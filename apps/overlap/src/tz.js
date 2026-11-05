// Time-zone maths on top of Intl (DST-aware, including 30/45-minute offsets). All instants are epoch milliseconds.
const fmtCache = new Map();
const fmt = (tz) => { let f = fmtCache.get(tz); if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); fmtCache.set(tz, f); } return f; };
// Intl.supportedValuesOf() lists legacy IDs (Asia/Calcutta, Europe/Kiev …); accept the modern spellings too and prefer them in the UI.
const MODERN = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'Atlantic/Faeroe': 'Atlantic/Faroe', 'Pacific/Ponape': 'Pacific/Pohnpei', 'Pacific/Truk': 'Pacific/Chuuk' };
const IANA = /^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/;   // region/city style only: rejects "+05:00", "../x", spaces, empty
const canBuild = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
export const isValidZone = (tz) => typeof tz === 'string' && tz.length <= 64 && IANA.test(tz) && canBuild(tz);
let zoneList; export const allZones = () => (zoneList ??= ['UTC', ...Intl.supportedValuesOf('timeZone').map((z) => (MODERN[z] && canBuild(MODERN[z]) ? MODERN[z] : z))].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b))));

/** Wall-clock parts of an instant in a zone. */
export function localParts(tz, ms) {
  const o = {}; for (const p of fmt(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}
/** Offset from UTC in minutes at that instant (e.g. New York in July = -240, Kolkata = 330). */
export function offsetMinutes(tz, ms) { const p = localParts(tz, ms); return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000); }
/** The instant when the wall clock in `tz` shows y-m-d 00:00 (handles zones whose midnight is skipped by falling forward). */
export function localMidnight(tz, y, m, d) {
  let guess = Date.UTC(y, m - 1, d); for (let i = 0; i < 3; i++) guess = Date.UTC(y, m - 1, d) - offsetMinutes(tz, guess) * 60000;
  const p = localParts(tz, guess); return p.d === d ? guess : guess + 3600000;   // midnight doesn't exist (e.g. Sao Paulo historical DST): first valid instant of that day
}
export const isDate = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
export const cityName = (tz) => tz.split('/').at(-1).replaceAll('_', ' ');

const SLOT = 15 * 60000, SLOTS = 96;   // 15-minute resolution is exact for every real-world offset (whole, :30 and :45) and whole-hour working windows
/**
 * Find when everybody is inside their working window.
 * zones: ['America/New_York', ...]; date: 'YYYY-MM-DD' = the calendar day in the FIRST zone; the grid is the 24 hours from that zone's local midnight.
 * work: {start, end} whole hours 0..24 (local, end exclusive); `windows` optionally overrides per zone (aligned with zones).
 * Returns per-zone working segments (for drawing) and the common windows, with minute-exact start/end.
 */
export function findOverlap(zones, date, work = { start: 9, end: 17 }, windows = null) {
  const [y, m, d] = date.split('-').map(Number), t0 = localMidnight(zones[0], y, m, d), slots = [];
  for (let i = 0; i < SLOTS; i++) {
    const t = t0 + i * SLOT;
    const per = zones.map((tz, k) => { const w = windows?.[k] ?? work, p = localParts(tz, t), mins = p.h * 60 + p.mi; return { zone: tz, h: p.h, mi: p.mi, day: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`, working: mins >= w.start * 60 && mins < w.end * 60 }; });
    slots.push({ t, per, all: per.every((x) => x.working) });
  }
  const runs = (pick) => { const out = []; let run = null; slots.forEach((s, i) => { if (pick(s)) { if (!run) run = { from: i, to: i + 1 }; else run.to = i + 1; } else if (run) { out.push(run); run = null; } }); if (run) out.push(run); return out; };
  const wins = runs((s) => s.all).map((r) => { const start = t0 + r.from * SLOT, end = t0 + r.to * SLOT; return { start, end, minutes: (r.to - r.from) * 15, local: zones.map((tz, k) => ({ zone: tz, start: hm(localParts(tz, start)), end: hm(localParts(tz, end)), day: slots[r.from].per[k].day })) }; });
  const perZone = zones.map((tz, k) => ({ zone: tz, offset: offsetMinutes(tz, t0), segments: runs((s) => s.per[k].working).map((r) => ({ from: r.from, to: r.to })) }));
  return { start: t0, slotMinutes: 15, slots: slots.map((s) => ({ t: s.t, all: s.all, per: s.per.map((x) => ({ h: x.h, mi: x.mi, working: x.working })) })), zones: perZone, windows: wins, best: wins.reduce((b, w) => (!b || w.minutes > b.minutes ? w : b), null) };
}
const hm = (p) => `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
