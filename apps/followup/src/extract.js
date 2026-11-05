// Natural-language due dates and action-item extraction for meeting notes. Pure functions, shared by server/browser/tests.
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBR = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_ABBR = { jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const NUMWORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };

export const isDate = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
const toDate = (s) => new Date(s + 'T00:00:00Z'), iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const weekday = (s) => toDate(s).getUTCDay();
const mondayOf = (s) => addDays(s, -((weekday(s) + 6) % 7));
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function addMonths(s, n) { const d = toDate(s), day = d.getUTCDate(), t = d.getUTCFullYear() * 12 + d.getUTCMonth() + n, y = Math.floor(t / 12), m = (t % 12) + 1; return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, daysIn(y, m))).padStart(2, '0')}`; }
const mk = (y, m, d) => { const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return isDate(s) ? s : null; };
/** Next occurrence of month/day on or after `ref` (this year if still ahead, else next year). Handles Feb 29. */
function nextMonthDay(ref, m, d) { const y = Number(ref.slice(0, 4)); for (let k = 0; k < 8; k++) { const c = mk(y + k, m, d); if (c && c >= ref) return c; } return null; }
const num = (w) => (/^\d+$/.test(w) ? Number(w) : NUMWORDS[w.toLowerCase()] ?? null);

const WD = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
const MN = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const wdIndex = (w) => { const k = w.toLowerCase(); const full = DAYS.indexOf(k); return full >= 0 ? full : DAY_ABBR[k]; };
const monIndex = (w) => { const k = w.toLowerCase(), full = MONTHS.indexOf(k); return full >= 0 ? full + 1 : MON_ABBR[k.replace('.', '')] ?? (k === 'may' ? 5 : k === 'june' ? 6 : k === 'july' ? 7 : null); };
const RULES = [
  [/\b(?:asap|as soon as possible)\b/i, () => null],
  [/\b(?:today|eod|end of (?:the )?day|tonight)\b/i, (m, ref) => ref],
  [/\btomorrow\b/i, (m, ref) => addDays(ref, 1)],
  [/\bday after tomorrow\b/i, (m, ref) => addDays(ref, 2)],
  [/\b(?:eow|end of (?:the )?week)\b/i, (m, ref) => { const fri = addDays(mondayOf(ref), 4); return fri >= ref ? fri : addDays(fri, 7); }],
  [/\b(?:eom|end of (?:the )?month)\b/i, (m, ref) => { const y = Number(ref.slice(0, 4)), mo = Number(ref.slice(5, 7)); return mk(y, mo, daysIn(y, mo)); }],
  [/\bnext month\b/i, (m, ref) => addMonths(ref, 1)],
  [/\bnext week\b/i, (m, ref) => addDays(mondayOf(ref), 7)],
  [/\bin (\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|(?:a )?couple of|(?:a )?few) (day|week|month)s?\b/i, (m, ref) => { const n = num(m[1].replace(/^a /i, '').replace(/ of$/i, '')); if (n == null) return null; const u = m[2].toLowerCase(); return u === 'day' ? addDays(ref, n) : u === 'week' ? addDays(ref, 7 * n) : addMonths(ref, n); }],
  [/\b(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten) (day|week|month)s? from (?:now|today)\b/i, (m, ref) => { const n = num(m[1]); const u = m[2].toLowerCase(); return u === 'day' ? addDays(ref, n) : u === 'week' ? addDays(ref, 7 * n) : addMonths(ref, n); }],
  [new RegExp(String.raw`\bnext ${WD}\b`, 'i'), (m, ref) => addDays(mondayOf(ref), 7 + ((wdIndex(m[1]) + 6) % 7))],                       // the weekday in the FOLLOWING Mon–Sun week
  [new RegExp(String.raw`\bthis ${WD}\b`, 'i'), (m, ref) => { const t = addDays(mondayOf(ref), (wdIndex(m[1]) + 6) % 7); return t >= ref ? t : addDays(t, 7); }],
  [/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => mk(+m[1], +m[2], +m[3])],
  [new RegExp(String.raw`\b${MN}\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b`, 'i'), (m, ref) => { const mo = monIndex(m[1]); return m[3] ? mk(+m[3], mo, +m[2]) : nextMonthDay(ref, mo, +m[2]); }],
  [new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)? (?:of )?${MN}\b\.?(?:,? (\d{4}))?`, 'i'), (m, ref) => { const mo = monIndex(m[2]); return m[3] ? mk(+m[3], mo, +m[1]) : nextMonthDay(ref, mo, +m[1]); }],
  [/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m, ref) => { const mo = +m[1], d = +m[2]; if (m[3]) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return mk(y, mo, d); } return nextMonthDay(ref, mo, d); }],   // US order month/day
  [new RegExp(String.raw`\b${WD}\b`, 'i'), (m, ref) => { const diff = (wdIndex(m[1]) - weekday(ref) + 7) % 7; return addDays(ref, diff === 0 ? 7 : diff); }],                  // bare weekday = next occurrence strictly after today
];
/** Find a due date in free text relative to `ref` (YYYY-MM-DD). Returns {date|null, match, index} or null if nothing date-like was found. */
export function parseDue(text, ref) {
  if (!isDate(ref)) throw new RangeError('ref must be a valid YYYY-MM-DD date');
  const s = String(text ?? ''); let best = null;
  for (const [re, fn] of RULES) { const m = re.exec(s); if (!m) continue; const date = fn(m, ref); if (best === null || m.index < best.index || (m.index === best.index && m[0].length > best.match.length)) best = { date: date && isDate(date) ? date : null, match: m[0], index: m.index, asap: /asap|as soon as/i.test(m[0]) }; }
  return best;
}

const OWNER = '([A-Z][a-z]{1,19}(?:\\s+[A-Z][a-z]{1,19})?)';
const LEAD = [
  [/^\s*(?:[-*•]\s*)?\[\s?\]\s*(.+)$/, null, 'checkbox'],
  [/^\s*(?:[-*•]\s*)?(?:todo|to-do|to do|action(?: item)?|ai|follow[- ]?up|task)\s*[:\-–]\s*(.+)$/i, null, 'label'],
  [/^\s*(?:[-*•]\s*)?@([A-Za-z][\w'-]{0,19})\s*(?:[:,\-–]|\s)\s*(?:to |will |should |needs? to |must |can )?(.+)$/, 'at', 'mention'],
  [new RegExp(String.raw`^\s*(?:[-*•]\s*)?${OWNER}\s+(?:will|to|should|needs? to|must|is going to|is responsible for|agreed to|volunteered to|takes?)\s+(.+)$`), 'name', 'owner-verb'],
  [/^\s*(?:[-*•]\s*)?(?:we|the team|everyone)\s+(?:need|needs|should|must|have) to\s+(.+)$/i, null, 'we-need'],
];
const NOT_NAMES = new Set(['we', 'they', 'he', 'she', 'it', 'i', 'you', 'this', 'that', 'there', 'everyone', 'someone', 'anyone', 'nobody', 'team', 'then', 'also', 'next', 'please']);   // capitalised words that start a sentence but are not people
const clean = (s) => s.replace(/\s+/g, ' ').replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '').replace(/\.$/, '').trim();

/** Extract action items from meeting notes. meetingDate is the reference for relative dates. */
export function extractTasks(notes, meetingDate) {
  const out = [], seen = new Set();
  String(notes ?? '').replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
    for (const [re, kind, source] of LEAD) {
      const m = re.exec(line); if (!m) continue;
      if (kind === 'name' && NOT_NAMES.has(m[1].toLowerCase())) continue;
      let owner = null, body;
      if (kind === 'name') { owner = m[1]; body = m[2]; } else if (kind === 'at') { owner = m[1]; body = m[2]; } else body = m[1];
      if (source === 'label' || source === 'checkbox') { const o = /^@([A-Z][a-z]{1,19})\b[\s:,-]*(?:to |will )?(.*)$/.exec(body) || /^([A-Z][a-z]{1,19}) (?:will|to|should) (.+)$/.exec(body); if (o) { owner = o[1]; body = o[2]; } }
      const due = parseDue(body, meetingDate); let text = body;
      if (due && (due.date || due.asap)) text = clean((body.slice(0, due.index) + body.slice(due.index + due.match.length)).replace(/\b(?:by|before|on|until|due|no later than|for|this)\s*$/i, '').replace(/\b(?:by|before|due|until|on|no later than)\s*(?=[,;.]|$)/i, ''));
      else text = clean(body);
      text = clean(text.replace(/\s+(?:by|before|due|until|on)$/i, ''));
      if (!text || text.length < 3) break;
      const key = `${(owner || '').toLowerCase()}|${text.toLowerCase()}`; if (seen.has(key)) break; seen.add(key);
      out.push({ text: text[0].toUpperCase() + text.slice(1), owner, due: due?.date ?? null, line: i + 1, source }); break;
    }
  });
  return out;
}
/** Bucket a due date relative to today: overdue | today | week (≤ 7 days) | later | none. */
export function bucket(due, today) { if (!due) return 'none'; if (due < today) return 'overdue'; if (due === today) return 'today'; return due <= addDays(today, 7) ? 'week' : 'later'; }
