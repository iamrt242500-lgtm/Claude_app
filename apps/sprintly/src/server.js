import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { isDate, dayNum, workingDays, ideal, remainingAt, forecast } from './sprint.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE sprints(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), start TEXT NOT NULL, end TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '' CHECK(length(goal) <= 200));
    CREATE TABLE tasks(id INTEGER PRIMARY KEY AUTOINCREMENT, sprint_id INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120), points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 100), added_day TEXT NOT NULL, done_day TEXT);
    CREATE INDEX idx_tasks_sprint ON tasks(sprint_id);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 10_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const todayOf = (sp) => { const utc = now().toISOString().slice(0, 10), c = sp?.get('today'); return c && isDate(c) && Math.abs(Date.parse(c + 'T00:00:00Z') - Date.parse(utc + 'T00:00:00Z')) <= 86400000 ? c : utc; };
  const sprint = (id) => { const s = q('SELECT * FROM sprints WHERE id=?').get(id); if (!s) throw new HttpError(404, 'Sprint not found'); return s; };
  const tasksOf = (id) => q('SELECT id, title, points, added_day addedDay, done_day doneDay FROM tasks WHERE sprint_id=? ORDER BY done_day IS NOT NULL, id').all(id);
  const task = (id) => { const t = q('SELECT * FROM tasks WHERE id=?').get(id); if (!t) throw new HttpError(404, 'Task not found'); return t; };
  function detail(s, today) {
    const tasks = tasksOf(s.id), days = workingDays(s.start, s.end), f = forecast(tasks, s.start, s.end, today), idl = ideal(f.scope, days);
    const chart = days.map((day, i) => ({ day, ideal: idl[i].ideal, remaining: day <= today ? remainingAt(tasks, day) : null }));
    return { id: s.id, name: s.name, start: s.start, end: s.end, goal: s.goal, today, tasks, forecast: f, chart, startPoint: f.scope, addedAfterStart: tasks.filter((t) => t.addedDay > s.start).reduce((a, t) => a + t.points, 0) };
  }
  function sprintIn(b, prev) {
    const d = {}, name = (b.name ?? prev?.name ?? '').toString().trim(), start = b.start ?? prev?.start, end = b.end ?? prev?.end, goal = (b.goal ?? prev?.goal ?? '').toString().trim();
    if (!name || name.length > 60) d.name = 'Name is required (max 60 characters)'; if (!isDate(start)) d.start = 'Start must be a valid YYYY-MM-DD'; if (!isDate(end)) d.end = 'End must be a valid YYYY-MM-DD';
    if (!d.start && !d.end) { if (end < start) d.end = 'End can’t be before the start'; else if (dayNum(end) - dayNum(start) > 59) d.end = 'A sprint can be at most 60 days long'; else if (workingDays(start, end).length === 0) d.end = 'The sprint needs at least one weekday'; }
    if (goal.length > 200) d.goal = 'Goal must be ≤ 200 characters'; if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { name, start, end, goal };
  }
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams, today = todayOf(sp);
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'sprints') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM sprints ORDER BY start DESC, id DESC').all().map((s) => { const d = detail(s, today); return { id: s.id, name: s.name, start: s.start, end: s.end, status: d.forecast.status, remaining: d.forecast.remaining, scope: d.forecast.scope, tasks: d.tasks.length }; }) };
      if (p.length === 1 && m === 'POST') { const v = sprintIn(await readBody(req)); const r = q('INSERT INTO sprints(name,start,end,goal) VALUES(?,?,?,?)').run(v.name, v.start, v.end, v.goal); return { status: 201, body: detail(sprint(Number(r.lastInsertRowid)), today) }; }
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const s = sprint(id);
      if (p.length === 2 && m === 'GET') return { body: detail(s, today) }; if (p.length === 2 && m === 'DELETE') { q('DELETE FROM sprints WHERE id=?').run(id); return { status: 204 }; }
      if (p.length === 2 && m === 'PATCH') { const v = sprintIn(await readBody(req), s); q('UPDATE sprints SET name=?, start=?, end=?, goal=? WHERE id=?').run(v.name, v.start, v.end, v.goal, id); return { body: detail(sprint(id), today) }; }
      if (p[2] === 'tasks' && m === 'POST') {
        const b = await readBody(req), d = {}, title = typeof b.title === 'string' ? b.title.trim() : '', addedDay = b.addedDay ?? today;
        if (!title || title.length > 120) d.title = 'Title is required (max 120 characters)'; if (!Number.isInteger(b.points) || b.points < 1 || b.points > 100) d.points = 'Points must be a whole number from 1 to 100'; if (!isDate(addedDay)) d.addedDay = 'Date must be a valid YYYY-MM-DD'; else if (addedDay > today) d.addedDay = 'A task can’t be added in the future';
        if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); q('INSERT INTO tasks(sprint_id,title,points,added_day) VALUES(?,?,?,?)').run(id, title, b.points, addedDay); return { status: 201, body: detail(s, today) };
      }
    }
    if (p[0] === 'tasks' && p[1]) {
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const t = task(id), s = sprint(t.sprint_id);
      if (m === 'DELETE') { q('DELETE FROM tasks WHERE id=?').run(id); return { body: detail(s, today) }; }
      if (m === 'PATCH') {
        const b = await readBody(req), d = {}, title = b.title === undefined ? t.title : typeof b.title === 'string' ? b.title.trim() : ''; let points = t.points, doneDay = t.done_day;
        if (!title || title.length > 120) d.title = 'Title is required (max 120 characters)'; if (b.points !== undefined) { if (!Number.isInteger(b.points) || b.points < 1 || b.points > 100) d.points = 'Points must be a whole number from 1 to 100'; else points = b.points; }
        if (b.done !== undefined) { if (typeof b.done !== 'boolean') d.done = 'done must be true or false'; else doneDay = b.done ? (today < t.added_day ? t.added_day : today) : null; }
        if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); q('UPDATE tasks SET title=?, points=?, done_day=? WHERE id=?').run(title, points, doneDay, id); return { body: detail(s, today) };
      }
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
      if (rel === 'sprint.js') return send(200, await readFile(join(SRC, 'sprint.js')), MIME['.js']);
      try { return send(200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] || 'application/octet-stream'); } catch { throw new HttpError(404, 'Not found'); }
    } catch (e) {
      if (e instanceof HttpError) { if (e.status === 413) res.setHeader('Connection', 'close'); return send(e.status, JSON.stringify({ error: e.message, details: e.details })); }
      if (e instanceof URIError) return send(400, JSON.stringify({ error: 'Bad request' }));
      console.error(e); send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/sprintly.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Sprintly listening on :${port}`));
}
