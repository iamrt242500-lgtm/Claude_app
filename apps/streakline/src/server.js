import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { isDate, addDays, diffDays, currentStreak, longestStreak, completionRate, normalizeSchedule, weekday } from './streak.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const HEAT_DAYS = 84;

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE habits(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), schedule TEXT NOT NULL, created_on TEXT NOT NULL);
    CREATE TABLE checkins(habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE, day TEXT NOT NULL, PRIMARY KEY(habit_id, day)) WITHOUT ROWID;
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 20_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  /** The user's "today": client-provided local date, accepted only if within ±1 day of server UTC (covers all timezones). */
  const todayOf = (url) => {
    const utc = now().toISOString().slice(0, 10), c = url.searchParams.get('today');
    return c && isDate(c) && Math.abs(diffDays(utc, c)) <= 1 ? c : utc;
  };
  const habit404 = (id) => { const h = q('SELECT * FROM habits WHERE id=?').get(id); if (!h) throw new HttpError(404, 'Habit not found'); return h; };
  const habitIn = (b) => {
    const name = typeof b.name === 'string' ? b.name.trim() : '', d = {};
    if (!name) d.name = 'Name is required'; else if (name.length > 80) d.name = 'Name must be ≤ 80 characters';
    const schedule = normalizeSchedule(b.schedule); if (!schedule) d.schedule = 'Pick at least one valid weekday';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
    return { name, schedule };
  };
  const view = (h, today) => {
    const days = q('SELECT day FROM checkins WHERE habit_id=? ORDER BY day').all(h.id).map((r) => r.day), done = new Set(days), schedule = JSON.parse(h.schedule);
    const start = days.length && days[0] < h.created_on ? days[0] : h.created_on;
    return { id: h.id, name: h.name, schedule, createdOn: h.created_on, scheduledToday: schedule.includes(weekday(today)), doneToday: done.has(today),
      currentStreak: currentStreak(schedule, done, start, today), longestStreak: longestStreak(schedule, done, start, today), rate30: completionRate(schedule, done, start, today), total: days.length,
      recent: days.filter((d) => d > addDays(today, -HEAT_DAYS)) };
  };

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, today = todayOf(url);
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] !== 'habits') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') return { body: { today, habits: q('SELECT * FROM habits ORDER BY id').all().map((h) => view(h, today)) } };
      if (m === 'POST') { const v = habitIn(await readBody(req)); const r = q('INSERT INTO habits(name,schedule,created_on) VALUES(?,?,?)').run(v.name, JSON.stringify(v.schedule), today); return { status: 201, body: view(habit404(Number(r.lastInsertRowid)), today) }; }
      throw new HttpError(405, 'Method not allowed');
    }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
    const h = habit404(id);
    if (p.length === 2) {
      if (m === 'GET') return { body: view(h, today) };
      if (m === 'PUT') { const v = habitIn(await readBody(req)); q('UPDATE habits SET name=?, schedule=? WHERE id=?').run(v.name, JSON.stringify(v.schedule), id); return { body: view(habit404(id), today) }; }
      if (m === 'DELETE') { q('DELETE FROM habits WHERE id=?').run(id); return { status: 204 }; }
    }
    if (p[2] === 'checkins' && p[3]) {
      const day = p[3];
      if (!isDate(day)) throw new HttpError(422, 'Validation failed', { date: 'Invalid date (YYYY-MM-DD)' });
      if (day > today) throw new HttpError(422, 'Validation failed', { date: 'Cannot check in for a future date' });
      if (diffDays(day, today) > 3650) throw new HttpError(422, 'Validation failed', { date: 'Date too far in the past' });
      if (m === 'PUT') { q('INSERT OR IGNORE INTO checkins(habit_id,day) VALUES(?,?)').run(id, day); return { body: view(habit404(id), today) }; }
      if (m === 'DELETE') { q('DELETE FROM checkins WHERE habit_id=? AND day=?').run(id, day); return { body: view(habit404(id), today) }; }
    }
    throw new HttpError(405, 'Method not allowed');
  }

  const server = createServer(async (req, res) => {
    const send = (s, b, t = 'application/json; charset=utf-8') => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store' }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body)); }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel.includes('..')) throw new HttpError(404, 'Not found');
      try { return send(200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] || 'application/octet-stream'); } catch { throw new HttpError(404, 'Not found'); }
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, JSON.stringify({ error: e.message, details: e.details }));
      if (e instanceof URIError) return send(400, JSON.stringify({ error: 'Bad request' }));
      console.error(e); send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/streakline.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Streakline listening on :${port}`));
}
