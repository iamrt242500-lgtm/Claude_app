import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { validateDrawing, toSvg } from './draw.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE drawings(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, strokes TEXT NOT NULL DEFAULT '[]', stroke_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now')));
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 8_000_000) throw new HttpError(413, 'Drawing is too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const get404 = (id) => { const d = q('SELECT * FROM drawings WHERE id=?').get(id); if (!d) throw new HttpError(404, 'Drawing not found'); return d; };
  const full = (d) => ({ id: d.id, title: d.title, strokes: JSON.parse(d.strokes), updatedAt: d.updated_at });
  const parsed = (b) => { const r = validateDrawing(b); if (r.errors) throw new HttpError(422, 'Validation failed', r.errors); return r.value; };

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] !== 'drawings') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') return { body: q('SELECT id, title, stroke_count strokeCount, updated_at updatedAt FROM drawings ORDER BY updated_at DESC, id DESC LIMIT 200').all() };
      if (m === 'POST') { const v = parsed(await readBody(req)); const r = q('INSERT INTO drawings(title,strokes,stroke_count) VALUES(?,?,?)').run(v.title, JSON.stringify(v.strokes), v.strokes.length); return { status: 201, body: full(get404(Number(r.lastInsertRowid))) }; }
      throw new HttpError(405, 'Method not allowed');
    }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const d = get404(id);
    if (p.length === 2) {
      if (m === 'GET') return { body: full(d) };
      if (m === 'PUT') { const v = parsed(await readBody(req)); q("UPDATE drawings SET title=?, strokes=?, stroke_count=?, updated_at=datetime('now') WHERE id=?").run(v.title, JSON.stringify(v.strokes), v.strokes.length, id); return { body: full(get404(id)) }; }
      if (m === 'DELETE') { q('DELETE FROM drawings WHERE id=?').run(id); return { status: 204 }; }
    }
    if (p[2] === 'svg' && m === 'GET') {
      const svg = toSvg(JSON.parse(d.strokes)), name = d.title.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'drawing';
      return { raw: svg, type: 'image/svg+xml; charset=utf-8', headers: url.searchParams.get('download') ? { 'Content-Disposition': `attachment; filename="${name}.svg"` } : {} };
    }
    throw new HttpError(405, 'Method not allowed');
  }

  const server = createServer(async (req, res) => {
    const send = (s, b, t = 'application/json; charset=utf-8', h = {}) => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store', ...h }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url); if (r.raw !== undefined) return send(200, r.raw, r.type, { ...r.headers, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Content-Disposition': r.headers?.['Content-Disposition'] ?? 'inline' }); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body)); }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel.includes('..')) throw new HttpError(404, 'Not found');
      if (rel === 'draw.js') return send(200, await readFile(join(SRC, 'draw.js')), MIME['.js']);   // shared with the browser
      try { return send(200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] || 'application/octet-stream'); } catch { throw new HttpError(404, 'Not found'); }
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, JSON.stringify({ error: e.message, details: e.details }), 'application/json; charset=utf-8', e.status === 413 ? { Connection: 'close' } : {});   // the unread request body makes this connection unusable for the client
      if (e instanceof URIError) return send(400, JSON.stringify({ error: 'Bad request' }));
      console.error(e); send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/sketchbook.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Sketchbook listening on :${port}`));
}
