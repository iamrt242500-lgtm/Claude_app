import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { isDate, addDays, dueDates, pickAssignee, fairness } from './chores.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const WINDOW = 28;

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE members(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 30), away_until TEXT);
    CREATE TABLE chores(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 10), every INTEGER NOT NULL CHECK(every BETWEEN 1 AND 365), start TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE assignments(id INTEGER PRIMARY KEY AUTOINCREMENT, chore_id INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE, due_day TEXT NOT NULL, member_id INTEGER REFERENCES members(id) ON DELETE SET NULL, points INTEGER NOT NULL, done_day TEXT, UNIQUE(chore_id, due_day));
    CREATE INDEX idx_assign_due ON assignments(due_day); CREATE INDEX idx_assign_member ON assignments(member_id, due_day);
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
  let depth = 0; const tx = (fn) => { if (depth) return fn(); db.exec('BEGIN'); depth++; try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { depth--; } };
  const todayOf = (sp) => { const utc = now().toISOString().slice(0, 10), c = sp?.get('today'); return c && isDate(c) && Math.abs(Date.parse(c + 'T00:00:00Z') - Date.parse(utc + 'T00:00:00Z')) <= 86400000 ? c : utc; };
  const members = () => q('SELECT id, name, away_until awayUntil FROM members ORDER BY name COLLATE NOCASE').all();
  /** Points assigned to each member in the WINDOW days up to and including `day` (done or not). */
  const loadAt = (day) => { const m = new Map(); for (const r of q('SELECT member_id id, SUM(points) p FROM assignments WHERE member_id IS NOT NULL AND due_day BETWEEN ? AND ? GROUP BY member_id').all(addDays(day, -WINDOW), day)) m.set(r.id, r.p); return m; };
  const lastDoneMap = (choreId, before) => { const m = new Map(); for (const r of q('SELECT member_id id, MAX(due_day) d FROM assignments WHERE chore_id=? AND member_id IS NOT NULL AND due_day<? GROUP BY member_id').all(choreId, before)) m.set(r.id, r.d); return m; };
  function pick(choreId, day, excludeAssignment = 0) {
    const load = loadAt(day); if (excludeAssignment) { const a = q('SELECT member_id, points, due_day FROM assignments WHERE id=?').get(excludeAssignment); if (a?.member_id && a.due_day >= addDays(day, -WINDOW) && a.due_day <= day) load.set(a.member_id, (load.get(a.member_id) || 0) - a.points); }
    return pickAssignee(day, members(), load, lastDoneMap(choreId, day));
  }
  /** Create (and fairly assign) every missing instance up to `upTo`. Idempotent. */
  function plan(upTo) {
    tx(() => {
      const missing = [];
      for (const c of q('SELECT * FROM chores WHERE archived=0').all()) for (const d of dueDates(c, c.start > addDays(upTo, -366) ? c.start : addDays(upTo, -366), upTo)) if (!q('SELECT 1 FROM assignments WHERE chore_id=? AND due_day=?').get(c.id, d)) missing.push({ c, d });
      missing.sort((a, b) => a.d.localeCompare(b.d) || b.c.points - a.c.points || a.c.id - b.c.id);
      for (const { c, d } of missing) q('INSERT INTO assignments(chore_id,due_day,member_id,points) VALUES(?,?,?,?)').run(c.id, d, pick(c.id, d), c.points);
    });
  }
  const row = (r) => ({ id: r.id, choreId: r.chore_id, chore: r.chore, dueDay: r.due_day, memberId: r.member_id, member: r.member ?? null, points: r.points, doneDay: r.done_day });
  const SEL = 'SELECT a.*, c.name chore, m.name member FROM assignments a JOIN chores c ON c.id=a.chore_id LEFT JOIN members m ON m.id=a.member_id';
  function board(today) {
    plan(addDays(today, 6)); const all = q(`${SEL} WHERE (a.done_day IS NULL AND a.due_day<=?) OR a.due_day BETWEEN ? AND ? ORDER BY a.due_day, c.name`).all(addDays(today, 6), today, addDays(today, 6)).map(row);
    const pending = (r) => !r.doneDay, ms = members(), from = addDays(today, -(WINDOW - 1)), done = {}, assigned = {};
    for (const m of ms) { done[m.id] = 0; assigned[m.id] = 0; }
    for (const r of q('SELECT member_id id, SUM(points) p FROM assignments WHERE member_id IS NOT NULL AND done_day IS NOT NULL AND due_day BETWEEN ? AND ? GROUP BY member_id').all(from, today)) done[r.id] = r.p;
    for (const r of q('SELECT member_id id, SUM(points) p FROM assignments WHERE member_id IS NOT NULL AND due_day BETWEEN ? AND ? GROUP BY member_id').all(from, today)) assigned[r.id] = r.p;
    return { today, overdue: all.filter((r) => pending(r) && r.dueDay < today), dueToday: all.filter((r) => r.dueDay === today), upcoming: all.filter((r) => r.dueDay > today), members: ms.map((m) => ({ ...m, donePoints: done[m.id], assignedPoints: assigned[m.id], away: !!m.awayUntil && m.awayUntil >= today })), fairness: fairness(assigned), windowDays: WINDOW };
  }
  const member = (id) => { const m = q('SELECT * FROM members WHERE id=?').get(id); if (!m) throw new HttpError(404, 'Member not found'); return m; };
  const chore = (id) => { const c = q('SELECT * FROM chores WHERE id=?').get(id); if (!c) throw new HttpError(404, 'Chore not found'); return c; };
  const choreDto = (c) => ({ id: c.id, name: c.name, points: c.points, every: c.every, start: c.start, archived: !!c.archived });
  function choreIn(b, prev) {
    const d = {}, name = (b.name ?? prev?.name ?? '').toString().trim(), points = b.points ?? prev?.points, every = b.every ?? prev?.every, start = b.start ?? prev?.start;
    if (!name || name.length > 60) d.name = 'Name is required (max 60 characters)'; if (!Number.isInteger(points) || points < 1 || points > 10) d.points = 'Points must be a whole number from 1 to 10'; if (!Number.isInteger(every) || every < 1 || every > 365) d.every = 'Repeat interval must be 1–365 days'; if (!isDate(start)) d.start = 'Start must be a valid YYYY-MM-DD';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { name, points, every, start };
  }
  /** After a member becomes unavailable, move their open assignments in the away window to other people. */
  function rebalance(memberId, today) {
    const m = member(memberId); if (!m.away_until) return;
    tx(() => { for (const a of q('SELECT * FROM assignments WHERE member_id=? AND done_day IS NULL AND due_day>=? AND due_day<=?').all(memberId, today, m.away_until)) q('UPDATE assignments SET member_id=? WHERE id=?').run(pick(a.chore_id, a.due_day, a.id), a.id); });
  }
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams, today = todayOf(sp);
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'board' && m === 'GET') return { body: board(today) };
    if (p[0] === 'members') {
      if (p.length === 1 && m === 'GET') return { body: members() };
      if (p.length === 1 && m === 'POST') { const b = await readBody(req), name = typeof b.name === 'string' ? b.name.trim() : ''; if (!name || name.length > 30) throw new HttpError(422, 'Validation failed', { name: 'Name is required (max 30 characters)' }); try { const r = q('INSERT INTO members(name) VALUES(?)').run(name); return { status: 201, body: members().find((x) => x.id === Number(r.lastInsertRowid)) }; } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(422, 'Validation failed', { name: 'Someone with that name already exists' }); throw e; } }
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const cur = member(id);
      if (m === 'PATCH') { const b = await readBody(req), d = {}; if (b.awayUntil !== undefined && b.awayUntil !== null && !isDate(b.awayUntil)) d.awayUntil = 'Date must be a valid YYYY-MM-DD'; if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 30)) d.name = 'Name is required (max 30 characters)'; if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); try { q('UPDATE members SET name=?, away_until=? WHERE id=?').run(b.name !== undefined ? b.name.trim() : cur.name, b.awayUntil === undefined ? cur.away_until : b.awayUntil, id); } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(422, 'Validation failed', { name: 'Someone with that name already exists' }); throw e; } rebalance(id, today); return { body: members().find((x) => x.id === id) }; }
      if (m === 'DELETE') { tx(() => { const open = q('SELECT * FROM assignments WHERE member_id=? AND done_day IS NULL').all(id); q('UPDATE assignments SET member_id=NULL WHERE member_id=? AND done_day IS NULL').run(id); q('DELETE FROM members WHERE id=?').run(id); for (const a of open) q('UPDATE assignments SET member_id=? WHERE id=?').run(pick(a.chore_id, a.due_day), a.id); }); return { status: 204 }; }
    }
    if (p[0] === 'chores') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM chores ORDER BY archived, name').all().map(choreDto) };
      if (p.length === 1 && m === 'POST') { const v = choreIn(await readBody(req)); const r = q('INSERT INTO chores(name,points,every,start) VALUES(?,?,?,?)').run(v.name, v.points, v.every, v.start); return { status: 201, body: choreDto(chore(Number(r.lastInsertRowid))) }; }
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const cur = chore(id);
      if (m === 'PATCH') { const b = await readBody(req); if (b.archived !== undefined && typeof b.archived !== 'boolean') throw new HttpError(422, 'Validation failed', { archived: 'archived must be true or false' }); const v = choreIn(b, cur); q('UPDATE chores SET name=?, points=?, every=?, start=?, archived=? WHERE id=?').run(v.name, v.points, v.every, v.start, b.archived === undefined ? cur.archived : b.archived ? 1 : 0, id); return { body: choreDto(chore(id)) }; }
      if (m === 'DELETE') { q('DELETE FROM chores WHERE id=?').run(id); return { status: 204 }; }
    }
    if (p[0] === 'assignments' && p[1] && m === 'PATCH') {
      const id = Number(p[1]), a = q('SELECT * FROM assignments WHERE id=?').get(id); if (!a) throw new HttpError(404, 'Assignment not found'); const b = await readBody(req), d = {};
      let memberId = a.member_id, doneDay = a.done_day;
      if (b.done !== undefined) { if (typeof b.done !== 'boolean') d.done = 'done must be true or false'; else doneDay = b.done ? today : null; }
      if (b.memberId !== undefined) { if (a.done_day) throw new HttpError(409, 'A finished chore can’t be reassigned'); if (b.memberId !== null && !(Number.isInteger(b.memberId) && q('SELECT 1 FROM members WHERE id=?').get(b.memberId))) d.memberId = 'Unknown member'; else memberId = b.memberId; }
      if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); if (doneDay && memberId === null) throw new HttpError(409, 'Assign someone before marking it done');
      q('UPDATE assignments SET member_id=?, done_day=? WHERE id=?').run(memberId, doneDay, id); return { body: row(q(`${SEL} WHERE a.id=?`).get(id)) };
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
      if (rel === 'chores.js') return send(200, await readFile(join(SRC, 'chores.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/chorewheel.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Chorewheel listening on :${port}`));
}
