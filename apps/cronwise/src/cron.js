// 5-field cron (minute hour day-of-month month day-of-week), evaluated in UTC.
export class CronError extends Error {}
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ALIASES = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };
const FIELDS = [
  { name: 'minute', min: 0, max: 59 }, { name: 'hour', min: 0, max: 23 }, { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, offset: 1 }, { name: 'day-of-week', min: 0, max: 7, names: DAYS, offset: 0 },
];

function parseValue(tok, f) {
  if (/^\d+$/.test(tok)) return Number(tok);
  const i = f.names ? f.names.indexOf(tok.toUpperCase()) : -1;
  if (i < 0) throw new CronError(`Invalid ${f.name} value "${tok}"`);
  return i + f.offset;
}
function parseField(text, f) {
  const set = new Set(); let restricted = true;
  if (text === '') throw new CronError(`Empty ${f.name} field`);
  for (const part of text.split(',')) {
    const [range, stepS, extra] = part.split('/');
    if (extra !== undefined || part === '') throw new CronError(`Invalid ${f.name} expression "${part}"`);
    let step = 1;
    if (stepS !== undefined) { if (!/^\d+$/.test(stepS) || Number(stepS) < 1) throw new CronError(`Invalid step "${stepS}" in ${f.name}`); step = Number(stepS); }
    let lo, hi;
    if (range === '*' || range === '?') { lo = f.min; hi = f.name === 'day-of-week' ? 6 : f.max; if (stepS === undefined) restricted = false; }
    else if (range.includes('-')) { const [a, b, c] = range.split('-'); if (c !== undefined) throw new CronError(`Invalid range "${range}" in ${f.name}`); lo = parseValue(a, f); hi = parseValue(b, f); }
    else { lo = parseValue(range, f); hi = stepS !== undefined ? f.max : lo; }
    if (lo < f.min || hi > f.max) throw new CronError(`${f.name} value out of range (${f.min}-${f.max})`);
    if (lo > hi) throw new CronError(`Range start is after end in ${f.name} ("${range}")`);
    for (let v = lo; v <= hi; v += step) set.add(f.name === 'day-of-week' && v === 7 ? 0 : v);
  }
  return { set, restricted };
}

export function parseCron(expr) {
  if (typeof expr !== 'string') throw new CronError('Expression must be text');
  let e = expr.trim().replace(/\s+/g, ' ');
  if (e.length > 200) throw new CronError('Expression too long');
  if (e.startsWith('@')) { if (!ALIASES[e.toLowerCase()]) throw new CronError(`Unknown alias "${e}"`); e = ALIASES[e.toLowerCase()]; }
  const parts = e.split(' ');
  if (parts.length !== 5) throw new CronError(`Expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`);
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  const out = { minute, hour, dom, month, dow, raw: parts };
  // Reject impossible dates (e.g. 31 Feb) that would never run.
  const MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (dom.restricted && !dow.restricted && ![...month.set].some((m) => [...dom.set].some((d) => d <= MAX_DAY[m - 1])))
    throw new CronError('This expression never runs (day-of-month does not exist in the selected months)');
  return out;
}

const dayMatches = (c, d) => {
  const domOk = c.dom.set.has(d.getUTCDate()), dowOk = c.dow.set.has(d.getUTCDay());
  if (c.dom.restricted && c.dow.restricted) return domOk || dowOk; // standard cron: OR when both restricted
  if (c.dom.restricted) return domOk; if (c.dow.restricted) return dowOk; return true;
};

/** Next `count` run times strictly after `from` (Date), UTC. */
export function nextRuns(expr, from = new Date(), count = 5) {
  const c = typeof expr === 'object' ? expr : parseCron(expr);
  const mins = [...c.minute.set].sort((a, b) => a - b), hrs = [...c.hour.set].sort((a, b) => a - b), out = [];
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let i = 0; i < 366 * 8 && out.length < count; i++, day.setUTCDate(day.getUTCDate() + 1)) {
    if (!c.month.set.has(day.getUTCMonth() + 1) || !dayMatches(c, day)) continue;
    for (const h of hrs) for (const m of mins) {
      const t = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m));
      if (t > from) { out.push(t); if (out.length >= count) return out; }
    }
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const list = (xs) => (xs.length <= 2 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ' and ' + xs.at(-1));
const isStep = (raw) => /^\*\/\d+$/.test(raw);

export function describe(expr) {
  const c = typeof expr === 'object' ? expr : parseCron(expr);
  const [rm, rh] = c.raw;
  const mins = [...c.minute.set].sort((a, b) => a - b), hrs = [...c.hour.set].sort((a, b) => a - b);
  let time;
  if (rm === '*' && rh === '*') time = 'Every minute';
  else if (isStep(rm) && rh === '*') time = `Every ${rm.slice(2)} minutes`;
  else if (rh === '*' && mins.length === 1) time = mins[0] === 0 ? 'Every hour, on the hour' : `At minute ${mins[0]} past every hour`;
  else if (rh === '*') time = `At minutes ${list(mins)} past every hour`;
  else if (isStep(rm) && rh !== '*') {
    const contiguous = hrs.every((h, i) => i === 0 || h === hrs[i - 1] + 1);
    time = `Every ${rm.slice(2)} minutes, ` + (contiguous && hrs.length > 1 ? `between ${pad(hrs[0])}:00 and ${pad(hrs.at(-1))}:59` : `during hour${hrs.length > 1 ? 's' : ''} ${list(hrs.map(String))}`);
  } else if (mins.length * hrs.length <= 6) time = 'At ' + list(hrs.flatMap((h) => mins.map((m) => `${pad(h)}:${pad(m)}`)));
  else if (mins.length === 1) time = `At minute ${mins[0]} past hours ${list(hrs.map(String))}`;
  else time = `At ${mins.length * hrs.length} times per day (minutes ${list(mins.map(String))}; hours ${list(hrs.map(String))})`;
  const parts = [time];
  const domText = c.dom.restricted ? `on day ${list([...c.dom.set].sort((a, b) => a - b).map(String))} of the month` : '';
  const dowText = c.dow.restricted ? `on ${list([...c.dow.set].sort((a, b) => a - b).map((d) => DAY_NAMES[d]))}` : '';
  if (domText && dowText) parts.push(`${domText} or ${dowText}`); else if (domText || dowText) parts.push(domText || dowText);
  else if (!c.month.restricted) parts.push('every day');
  if (c.month.restricted) parts.push('in ' + list([...c.month.set].sort((a, b) => a - b).map((m) => MONTH_NAMES[m - 1])));
  return parts.join(', ') + ' (UTC)';
}
