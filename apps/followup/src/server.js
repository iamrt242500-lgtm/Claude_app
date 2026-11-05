import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { extractTasks, isDate, bucket } from './extract.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE meetings(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120), day TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE tasks(id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE, text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 300), owner TEXT, due TEXT, done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)), manual INTEGER NOT NULL DEFAULT 0, edited INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE INDEX idx_tasks_meeting ON tasks(meeting_id); CREATE INDEX idx_tasks_due ON tasks(done, due);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 300_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const key = (t) => t.text.toLowerCase();

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const todayOf = (sp) => { const c = sp?.get('today'), utc = now().toISOString().slice(0, 10); return c && isDate(c) && Math.abs(Date.parse(c + 'T00:00:00Z') - Date.parse(utc + 'T00:00:00Z')) <= 86400000 ? c : utc; };
  const taskDto = (t, today) => ({ id: t.id, meetingId: t.meeting_id, meetingTitle: t.meeting_title ?? null, text: t.text, owner: t.owner, due: t.due, done: !!t.done, manual: !!t.manual, bucket: t.done ? 'done' : bucket(t.due, today) });
  const meeting404 = (id) => { const m = q('SELECT * FROM meetings WHERE id=?').get(id); if (!m) throw new HttpError(404, 'Meeting not found'); return m; };
  const task404 = (id) => { const t = q('SELECT t.*, m.title meeting_title FROM tasks t LEFT JOIN meetings m ON m.id=t.meeting_id WHERE t.id=?').get(id); if (!t) throw new HttpError(404, 'Task not found'); return t; };
  const meetingIn = (b) => {
    const d = {}, title = typeof b.title === 'string' ? b.title.trim() : '', notes = typeof b.notes === 'string' ? b.notes : '';
    if (!title) d.title = 'Title is required'; else if (title.length > 120) d.title = 'Title must be ≤ 120 characters'; if (!isDate(b.day)) d.day = 'Date must be a valid YYYY-MM-DD'; if (notes.length > 100_000) d.notes = 'Notes are too long (max 100,000 characters)';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { title, day: b.day, notes };
  };
  /** Re-extract tasks from the notes; keep done/owner/due edits of tasks that are still found, drop auto tasks that disappeared, keep manual ones. */
  function syncTasks(id, v) {
    const found = extractTasks(v.notes, v.day), existing = q('SELECT * FROM tasks WHERE meeting_id=? AND manual=0').all(id), byKey = new Map(existing.map((t) => [key(t), t])), keep = new Set();
    for (const f of found) {
      const hit = byKey.get(key(f));
      if (hit) { keep.add(hit.id); if (!hit.edited) q('UPDATE tasks SET due=? WHERE id=?').run(f.due, hit.id); }   // due phrase may have changed with the meeting date; user edits win
      else keep.add(Number(q('INSERT INTO tasks(meeting_id,text,owner,due) VALUES(?,?,?,?)').run(id, f.text, f.owner, f.due).lastInsertRowid));
    }
    for (const t of existing) if (!keep.has(t.id)) q('DELETE FROM tasks WHERE id=?').run(t.id);
  }
  const meetingDto = (m, today) => ({ id: m.id, title: m.title, day: m.day, notes: m.notes, tasks: q('SELECT t.*, ? meeting_title FROM tasks t WHERE t.meeting_id=? ORDER BY t.done, t.due IS NULL, t.due, t.id').all(m.title, m.id).map((t) => taskDto(t, today)) });

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams, today = todayOf(sp);
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'extract' && m === 'POST') { const b = await readBody(req); if (!isDate(b.day)) throw new HttpError(422, 'Validation failed', { day: 'Date must be a valid YYYY-MM-DD' }); return { body: extractTasks(typeof b.notes === 'string' ? b.notes.slice(0, 100_000) : '', b.day) }; }
    if (p[0] === 'meetings') {
      if (p.length === 1) {
        if (m === 'GET') return { body: q('SELECT m.id, m.title, m.day, (SELECT COUNT(*) FROM tasks WHERE meeting_id=m.id) tasks, (SELECT COUNT(*) FROM tasks WHERE meeting_id=m.id AND done=0) open FROM meetings m ORDER BY m.day DESC, m.id DESC').all() };
        if (m === 'POST') { const v = meetingIn(await readBody(req)); const id = tx(() => { const id = Number(q('INSERT INTO meetings(title,day,notes) VALUES(?,?,?)').run(v.title, v.day, v.notes).lastInsertRowid); syncTasks(id, v); return id; }); return { status: 201, body: meetingDto(meeting404(id), today) }; }
      } else {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const mt = meeting404(id);
        if (m === 'GET') return { body: meetingDto(mt, today) };
        if (m === 'PUT') { const v = meetingIn(await readBody(req)); tx(() => { q('UPDATE meetings SET title=?, day=?, notes=? WHERE id=?').run(v.title, v.day, v.notes, id); syncTasks(id, v); }); return { body: meetingDto(meeting404(id), today) }; }
        if (m === 'DELETE') { q('DELETE FROM meetings WHERE id=?').run(id); return { status: 204 }; }
      }
    }
    if (p[0] === 'tasks') {
      if (p.length === 1) {
        if (m === 'GET') {
          let rows = q('SELECT t.*, m.title meeting_title FROM tasks t LEFT JOIN meetings m ON m.id=t.meeting_id ORDER BY t.due IS NULL, t.due, t.id').all().map((t) => taskDto(t, today));
          if (sp.get('owner')) rows = rows.filter((t) => (t.owner || '').toLowerCase() === sp.get('owner').toLowerCase()); if (sp.get('status') === 'open') rows = rows.filter((t) => !t.done); else if (sp.get('status') === 'done') rows = rows.filter((t) => t.done);
          const owners = [...new Set(q('SELECT DISTINCT owner FROM tasks WHERE owner IS NOT NULL').all().map((r) => r.owner))].sort((a, b) => a.localeCompare(b));
          return { body: { today, owners, tasks: rows, counts: { overdue: rows.filter((t) => t.bucket === 'overdue').length, today: rows.filter((t) => t.bucket === 'today').length, open: rows.filter((t) => !t.done).length } } };
        }
        if (m === 'POST') {
          const b = await readBody(req), d = {}, text = typeof b.text === 'string' ? b.text.trim() : '', owner = typeof b.owner === 'string' && b.owner.trim() ? b.owner.trim() : null;
          if (!text) d.text = 'Task text is required'; else if (text.length > 300) d.text = 'Task text must be ≤ 300 characters'; if (owner && owner.length > 40) d.owner = 'Owner must be ≤ 40 characters'; if (b.due != null && b.due !== '' && !isDate(b.due)) d.due = 'Due date must be a valid YYYY-MM-DD';
          if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
          const r = q('INSERT INTO tasks(meeting_id,text,owner,due,manual) VALUES(?,?,?,?,1)').run(Number.isInteger(b.meetingId) && q('SELECT 1 FROM meetings WHERE id=?').get(b.meetingId) ? b.meetingId : null, text, owner, b.due || null); return { status: 201, body: taskDto(task404(Number(r.lastInsertRowid)), today) };
        }
      } else {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const t = task404(id);
        if (m === 'PATCH') {
          const b = await readBody(req), d = {}; const next = { done: t.done, owner: t.owner, due: t.due, text: t.text, edited: t.edited };
          if (b.done !== undefined) { if (typeof b.done !== 'boolean') d.done = 'done must be true or false'; else next.done = b.done ? 1 : 0; }
          if (b.owner !== undefined) { const o = typeof b.owner === 'string' ? b.owner.trim() : ''; if (o.length > 40) d.owner = 'Owner must be ≤ 40 characters'; else { next.owner = o || null; next.edited = 1; } }
          if (b.due !== undefined) { if (b.due !== null && b.due !== '' && !isDate(b.due)) d.due = 'Due date must be a valid YYYY-MM-DD'; else { next.due = b.due || null; next.edited = 1; } }
          if (b.text !== undefined) { const x = typeof b.text === 'string' ? b.text.trim() : ''; if (!x || x.length > 300) d.text = 'Task text is required (max 300 characters)'; else { next.text = x; next.edited = 1; } }
          if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
          q('UPDATE tasks SET done=?, owner=?, due=?, text=?, edited=? WHERE id=?').run(next.done, next.owner, next.due, next.text, next.edited, id); return { body: taskDto(task404(id), today) };
        }
        if (m === 'DELETE') { q('DELETE FROM tasks WHERE id=?').run(id); return { status: 204 }; }
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
      if (rel === 'extract.js') return send(200, await readFile(join(SRC, 'extract.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/followup.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Followup listening on :${port}`));
}
