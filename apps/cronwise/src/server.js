import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { parseCron, nextRuns, describe, CronError } from './cron.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1)
    db.exec(`BEGIN; CREATE TABLE jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80), expr TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now'))); PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 20_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
function explain(expr, count, now) {
  try {
    const c = parseCron(expr);
    const runs = nextRuns(c, now, count);
    return { valid: true, expr: c.raw.join(' '), description: describe(c), next: runs.map((d) => d.toISOString()) };
  } catch (e) { if (e instanceof CronError) return { valid: false, error: e.message }; throw e; }
}

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const view = (j) => { const e = explain(j.expr, 1, now()); return { id: j.id, label: j.label, expr: j.expr, description: e.description, nextRun: e.next?.[0] ?? null }; };
  const input = (b) => {
    const label = typeof b.label === 'string' ? b.label.trim() : '', expr = typeof b.expr === 'string' ? b.expr.trim().replace(/\s+/g, ' ') : '';
    const details = {};
    if (!label) details.label = 'Label is required'; else if (label.length > 80) details.label = 'Label must be ≤ 80 characters';
    const e = explain(expr, 1, now()); if (!e.valid) details.expr = e.error;
    if (Object.keys(details).length) throw new HttpError(422, 'Validation failed', details);
    return { label, expr };
  };
  const one = (id) => { const j = q('SELECT * FROM jobs WHERE id=?').get(id); if (!j) throw new HttpError(404, 'Job not found'); return j; };

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'explain' && m === 'POST') {
      const b = await readBody(req), count = Math.min(25, Math.max(1, Number(b.count) || 8));
      return { body: explain(typeof b.expr === 'string' ? b.expr : '', count, now()) };
    }
    if (p[0] !== 'jobs') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') return { body: q('SELECT * FROM jobs ORDER BY id DESC').all().map(view) };
      if (m === 'POST') { const v = input(await readBody(req)); const r = q('INSERT INTO jobs(label,expr) VALUES(?,?)').run(v.label, v.expr); return { status: 201, body: view(one(Number(r.lastInsertRowid))) }; }
      throw new HttpError(405, 'Method not allowed');
    }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
    one(id);
    if (m === 'PUT') { const v = input(await readBody(req)); q('UPDATE jobs SET label=?, expr=? WHERE id=?').run(v.label, v.expr, id); return { body: view(one(id)) }; }
    if (m === 'DELETE') { q('DELETE FROM jobs WHERE id=?').run(id); return { status: 204 }; }
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/cronwise.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Cronwise listening on :${port}`));
}
