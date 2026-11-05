import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { diffTexts, unified, LIMITS } from './diff.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d, h) { super(m); this.status = s; this.details = d; this.headers = h; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE comparisons(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100), left_text TEXT NOT NULL, right_text TEXT NOT NULL, ignore_ws INTEGER NOT NULL DEFAULT 0, ignore_case INTEGER NOT NULL DEFAULT 0,
      added INTEGER NOT NULL, removed INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 1_200_000) throw new HttpError(413, 'Payload too large', null, { Connection: 'close' }); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const compare = (b) => {
  const d = {}; if (typeof b.left !== 'string') d.left = 'left must be text'; if (typeof b.right !== 'string') d.right = 'right must be text';
  if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
  try { return diffTexts(b.left, b.right, { ignoreWhitespace: !!b.ignoreWhitespace, ignoreCase: !!b.ignoreCase }); } catch (e) { if (e instanceof RangeError) throw new HttpError(422, 'Validation failed', { left: e.message }); throw e; }
};

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const row = (r, full) => ({ id: r.id, title: r.title, added: r.added, removed: r.removed, ignoreWhitespace: !!r.ignore_ws, ignoreCase: !!r.ignore_case, createdAt: r.created_at, ...(full ? { left: r.left_text, right: r.right_text } : {}) });
  const get404 = (id) => { const r = q('SELECT * FROM comparisons WHERE id=?').get(id); if (!r) throw new HttpError(404, 'Comparison not found'); return r; };

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'diff' && m === 'POST') { const b = await readBody(req), r = compare(b); return { body: { ...r, unified: unified(r, { leftName: 'left', rightName: 'right' }) } }; }
    if (p[0] !== 'comparisons') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') return { body: q('SELECT id, title, added, removed, ignore_ws, ignore_case, created_at FROM comparisons ORDER BY id DESC LIMIT 200').all().map((r) => row(r)) };
      if (m === 'POST') {
        const b = await readBody(req), title = typeof b.title === 'string' ? b.title.trim() : ''; if (!title || title.length > 100) throw new HttpError(422, 'Validation failed', { title: title ? 'Title must be ≤ 100 characters' : 'Title is required' });
        const r = compare(b), res = q('INSERT INTO comparisons(title,left_text,right_text,ignore_ws,ignore_case,added,removed) VALUES(?,?,?,?,?,?,?)').run(title, b.left, b.right, b.ignoreWhitespace ? 1 : 0, b.ignoreCase ? 1 : 0, r.stats.added, r.stats.removed);
        return { status: 201, body: row(get404(Number(res.lastInsertRowid)), true) };
      }
      throw new HttpError(405, 'Method not allowed');
    }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const r = get404(id);
    if (m === 'GET' && p.length === 2) return { body: row(r, true) };
    if (m === 'DELETE' && p.length === 2) { q('DELETE FROM comparisons WHERE id=?').run(id); return { status: 204 }; }
    throw new HttpError(405, 'Method not allowed');
  }

  const server = createServer(async (req, res) => {
    const send = (s, b, t = 'application/json; charset=utf-8', h = {}) => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store', ...h }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body)); }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel.includes('..')) throw new HttpError(404, 'Not found');
      if (rel === 'diff.js') return send(200, await readFile(join(SRC, 'diff.js')), MIME['.js']);   // shared with the browser for instant, offline-capable diffs
      try { return send(200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] || 'application/octet-stream'); } catch { throw new HttpError(404, 'Not found'); }
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, JSON.stringify({ error: e.message, details: e.details }), 'application/json; charset=utf-8', e.headers ?? {});
      if (e instanceof URIError) return send(400, JSON.stringify({ error: 'Bad request' }));
      console.error(e); send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/diffly.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Diffly listening on :${port} (limit ${LIMITS.text} chars / ${LIMITS.lines} lines per side)`));
}
