import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { toMin, isDate, addDays, weekStart, span, hours, problems, totals, coverage } from './roster.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE people(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 40), role TEXT NOT NULL DEFAULT '' CHECK(length(role) <= 30), unavailable TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE timeoff(id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE, day TEXT NOT NULL, UNIQUE(person_id, day));
    CREATE TABLE shifts(id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER REFERENCES people(id) ON DELETE SET NULL, day TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 100));
    CREATE INDEX idx_shifts_day ON shifts(day); CREATE INDEX idx_shifts_person ON shifts(person_id, day);
    CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id = 1), max_weekly REAL NOT NULL, min_rest REAL NOT NULL);
    INSERT INTO settings VALUES(1, 40, 11);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 20_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const person = (id) => { const p = q('SELECT * FROM people WHERE id=?').get(id); if (!p) throw new HttpError(404, 'Person not found'); return p; };
  const personDto = (p) => ({ id: p.id, name: p.name, role: p.role, unavailable: JSON.parse(p.unavailable) });
  const rules = () => { const s = q('SELECT * FROM settings').get(); return { maxWeeklyHours: s.max_weekly, minRestHours: s.min_rest }; };
  const rulesFor = (pid) => { const p = person(pid); return { ...rules(), unavailable: JSON.parse(p.unavailable).map((w) => ({ weekday: w })), timeOff: q('SELECT day FROM timeoff WHERE person_id=?').all(pid).map((r) => r.day) }; };
  const shiftsOf = (pid, day, excludeId = 0) => q('SELECT * FROM shifts WHERE person_id=? AND day BETWEEN ? AND ? AND id<>?').all(pid, addDays(day, -8), addDays(day, 8), excludeId);
  const check = (s, excludeId = 0) => (s.person_id ? problems(s, shiftsOf(s.person_id, s.day, excludeId), rulesFor(s.person_id)) : []);
  const shiftDto = (s) => ({ id: s.id, personId: s.person_id, day: s.day, start: s.start, end: s.end, note: s.note, hours: hours(s), problems: check(s, s.id) });
  function shiftIn(b, prev) {
    const d = {}, day = b.day ?? prev?.day, start = b.start ?? prev?.start, end = b.end ?? prev?.end, note = typeof (b.note ?? prev?.note ?? '') === 'string' ? (b.note ?? prev?.note ?? '').trim() : null;
    if (!isDate(day)) d.day = 'Date must be a valid YYYY-MM-DD'; if (toMin(start) === null) d.start = 'Start must be HH:MM (24 h)'; if (toMin(end) === null) d.end = 'End must be HH:MM (24 h)';
    if (!d.day && !d.start && !d.end && !span({ day, start, end })) d.end = start === end ? 'End must differ from start' : 'Shifts can’t be longer than 16 hours';
    if (note === null || note.length > 100) d.note = 'Note must be ≤ 100 characters';
    let personId = b.personId !== undefined ? b.personId : prev?.person_id ?? null; if (personId !== null && !(Number.isInteger(personId) && q('SELECT 1 FROM people WHERE id=?').get(personId))) d.personId = 'Unknown person';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { person_id: personId, day, start, end, note };
  }
  function saveShift(b, prev, id) {
    const s = shiftIn(b, prev), found = check(s, id || 0);
    if (found.length && b.force !== true) throw Object.assign(new HttpError(409, 'Scheduling conflict', undefined), { problems: found });
    if (id) { q('UPDATE shifts SET person_id=?, day=?, start=?, end=?, note=? WHERE id=?').run(s.person_id, s.day, s.start, s.end, s.note, id); return id; }
    return Number(q('INSERT INTO shifts(person_id,day,start,end,note) VALUES(?,?,?,?,?)').run(s.person_id, s.day, s.start, s.end, s.note).lastInsertRowid);
  }
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'settings') {
      if (m === 'GET') return { body: rules() };
      if (m === 'PUT') { const b = await readBody(req), d = {}; if (!(typeof b.maxWeeklyHours === 'number' && b.maxWeeklyHours >= 1 && b.maxWeeklyHours <= 168)) d.maxWeeklyHours = 'Max weekly hours must be between 1 and 168'; if (!(typeof b.minRestHours === 'number' && b.minRestHours >= 0 && b.minRestHours <= 24)) d.minRestHours = 'Minimum rest must be between 0 and 24 hours'; if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); q('UPDATE settings SET max_weekly=?, min_rest=? WHERE id=1').run(b.maxWeeklyHours, b.minRestHours); return { body: rules() }; }
    }
    if (p[0] === 'people') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM people ORDER BY name COLLATE NOCASE').all().map(personDto) };
      const inp = (b) => { const d = {}, name = typeof b.name === 'string' ? b.name.trim() : '', role = typeof (b.role ?? '') === 'string' ? (b.role ?? '').trim() : null, un = b.unavailable ?? []; if (!name || name.length > 40) d.name = 'Name is required (max 40 characters)'; if (role === null || role.length > 30) d.role = 'Role must be ≤ 30 characters'; if (!Array.isArray(un) || !un.every((w) => Number.isInteger(w) && w >= 0 && w <= 6)) d.unavailable = 'Unavailable days must be weekday numbers 0–6'; if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { name, role, un: [...new Set(un)].sort() }; };
      if (p.length === 1 && m === 'POST') { const v = inp(await readBody(req)); try { const r = q('INSERT INTO people(name,role,unavailable) VALUES(?,?,?)').run(v.name, v.role, JSON.stringify(v.un)); return { status: 201, body: personDto(person(Number(r.lastInsertRowid))) }; } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(422, 'Validation failed', { name: 'Someone with that name already exists' }); throw e; } }
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); person(id);
      if (p.length === 2 && m === 'PUT') { const v = inp(await readBody(req)); try { q('UPDATE people SET name=?, role=?, unavailable=? WHERE id=?').run(v.name, v.role, JSON.stringify(v.un), id); } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(422, 'Validation failed', { name: 'Someone with that name already exists' }); throw e; } return { body: personDto(person(id)) }; }
      if (p.length === 2 && m === 'DELETE') { q('DELETE FROM people WHERE id=?').run(id); return { status: 204 }; }   // their shifts become open shifts
    }
    if (p[0] === 'timeoff') {
      if (m === 'GET') return { body: q('SELECT t.id, t.person_id personId, t.day FROM timeoff t ORDER BY t.day, t.id').all() };
      if (m === 'POST') { const b = await readBody(req), d = {}; if (!Number.isInteger(b.personId) || !q('SELECT 1 FROM people WHERE id=?').get(b.personId)) d.personId = 'Unknown person'; if (!isDate(b.day)) d.day = 'Date must be a valid YYYY-MM-DD'; if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); q('INSERT OR IGNORE INTO timeoff(person_id,day) VALUES(?,?)').run(b.personId, b.day); return { status: 201, body: q('SELECT id, person_id personId, day FROM timeoff WHERE person_id=? AND day=?').get(b.personId, b.day) }; }
      if (m === 'DELETE' && p[1]) { const r = q('DELETE FROM timeoff WHERE id=?').run(Number(p[1])); if (!r.changes) throw new HttpError(404, 'Not found'); return { status: 204 }; }
    }
    if (p[0] === 'shifts') {
      if (p.length === 1 && m === 'POST') { const id = saveShift(await readBody(req), null, 0); return { status: 201, body: shiftDto(q('SELECT * FROM shifts WHERE id=?').get(id)) }; }
      if (p.length === 2) {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const s = q('SELECT * FROM shifts WHERE id=?').get(id); if (!s) throw new HttpError(404, 'Shift not found');
        if (m === 'GET') return { body: shiftDto(s) }; if (m === 'PUT') { saveShift(await readBody(req), s, id); return { body: shiftDto(q('SELECT * FROM shifts WHERE id=?').get(id)) }; }
        if (m === 'DELETE') { q('DELETE FROM shifts WHERE id=?').run(id); return { status: 204 }; }
      }
    }
    if (p[0] === 'schedule' && m === 'GET') {
      const day = sp.get('week') ?? new Date().toISOString().slice(0, 10); if (!isDate(day)) throw new HttpError(400, 'Invalid date'); const from = weekStart(day), to = addDays(from, 6);
      const shifts = q('SELECT * FROM shifts WHERE day BETWEEN ? AND ? ORDER BY day, start, id').all(from, to).map(shiftDto), prevNight = q('SELECT * FROM shifts WHERE day=?').all(addDays(from, -1));
      const cov = {}; for (let i = 0; i < 7; i++) { const d = addDays(from, i); cov[d] = coverage([...shifts, ...(i === 0 ? prevNight : [])], d); }
      return { body: { from, to, shifts, hoursByPerson: totals(shifts.map((s) => ({ ...s, personId: s.personId })).filter((s) => s.personId)), coverage: cov, open: shifts.filter((s) => s.personId === null).length, problems: shifts.reduce((n, s) => n + s.problems.length, 0) } };
    }
    throw new HttpError(404, 'Not found');
  }
  const server = createServer(async (req, res) => {
    const send = (s, b, t = 'application/json; charset=utf-8') => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store' }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body)); }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel.includes('..')) throw new HttpError(404, 'Not found');
      if (rel === 'roster.js') return send(200, await readFile(join(SRC, 'roster.js')), MIME['.js']);
      try { return send(200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] || 'application/octet-stream'); } catch { throw new HttpError(404, 'Not found'); }
    } catch (e) {
      if (e instanceof HttpError) { if (e.status === 413) res.setHeader('Connection', 'close'); return send(e.status, JSON.stringify({ error: e.message, details: e.details, problems: e.problems })); }
      if (e instanceof URIError) return send(400, JSON.stringify({ error: 'Bad request' }));
      console.error(e); send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/rosterly.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Rosterly listening on :${port}`));
}
