import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { KINDS, summarize, validTz } from './timer.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE sessions(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('focus','short','long')), label TEXT NOT NULL DEFAULT '', minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 180),
      started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','completed','cancelled')), finished_at INTEGER);
    CREATE UNIQUE INDEX one_active ON sessions(status) WHERE status = 'active';
    CREATE INDEX idx_sessions_finished ON sessions(finished_at); PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 10_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:', now = () => Date.now() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const dto = (s) => ({ id: s.id, kind: s.kind, label: s.label, minutes: s.minutes, startedAt: s.started_at, endsAt: s.ends_at, status: s.status, finishedAt: s.finished_at });
  /** Lazily complete an active session whose time is up (survives restarts, closed tabs, sleeping laptops). */
  const settle = () => { const t = now(); q("UPDATE sessions SET status='completed', finished_at=ends_at WHERE status='active' AND ends_at <= ?").run(t); return t; };
  const tzOf = (sp) => { const raw = sp.get('tz'); if (raw == null) return 0; const v = Number(raw); return validTz(v) ? v : 0; };
  function state(sp) {
    const t = settle(), tz = tzOf(sp), active = q("SELECT * FROM sessions WHERE status='active'").get();
    const done = q("SELECT * FROM sessions WHERE status<>'active' ORDER BY id DESC LIMIT 2000").all().map((s) => ({ ...dto(s), finishedAt: s.finished_at }));
    return { now: t, active: active ? dto(active) : null, stats: summarize(done, t, tz), history: done.slice(0, 15), labels: [...new Set(q("SELECT label FROM sessions WHERE label<>'' ORDER BY id DESC LIMIT 50").all().map((r) => r.label))].slice(0, 10) };
  }

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'state' && m === 'GET') return { body: state(url.searchParams) };
    if (p[0] === 'sessions' && p[1] === 'start' && m === 'POST') {
      const b = await readBody(req), d = {}, t = settle();
      const kind = b.kind, minutes = b.minutes, label = typeof b.label === 'string' ? b.label.trim() : '';
      if (!KINDS[kind]) d.kind = 'kind must be focus, short or long';
      else if (!Number.isInteger(minutes) || minutes < KINDS[kind].min || minutes > KINDS[kind].max) d.minutes = `Minutes must be a whole number from ${KINDS[kind].min} to ${KINDS[kind].max}`;
      if (label.length > 60) d.label = 'Label must be ≤ 60 characters';
      if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
      if (q("SELECT 1 FROM sessions WHERE status='active'").get()) throw new HttpError(409, 'A session is already running');
      q("INSERT INTO sessions(kind,label,minutes,started_at,ends_at,status) VALUES(?,?,?,?,?, 'active')").run(kind, label, minutes, t, t + minutes * 60000);
      return { status: 201, body: state(url.searchParams) };
    }
    if (p[0] === 'sessions' && p[1] === 'stop' && m === 'POST') {
      const t = settle(), a = q("SELECT * FROM sessions WHERE status='active'").get();
      if (!a) throw new HttpError(409, 'No session is running');
      q("UPDATE sessions SET status='cancelled', finished_at=? WHERE id=?").run(t, a.id);
      return { body: state(url.searchParams) };
    }
    if (p[0] === 'sessions' && p.length === 2 && m === 'DELETE') {
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
      const r = q("DELETE FROM sessions WHERE id=? AND status<>'active'").run(id); if (!r.changes) throw new HttpError(404, 'Session not found');
      return { body: state(url.searchParams) };
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
      if (rel === 'timer.js') return send(200, await readFile(join(dirname(PUBLIC), 'src', 'timer.js')), MIME['.js']);   // shared with the browser
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/focusly.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Focusly listening on :${port}`));
}
