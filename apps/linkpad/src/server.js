import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { extractLinks, renameLinks, toFtsQuery, validateNote } from './links.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL UNIQUE COLLATE NOCASE, body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE note_links(from_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE, target TEXT NOT NULL, PRIMARY KEY(from_id, target));
    CREATE INDEX idx_note_links_target ON note_links(target);
    CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tokenize='porter unicode61');
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 400_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const get404 = (id) => { const n = q('SELECT * FROM notes WHERE id=?').get(id); if (!n) throw new HttpError(404, 'Note not found'); return n; };
  const reindex = (id, title, body) => {
    q('DELETE FROM notes_fts WHERE rowid=?').run(id); q('INSERT INTO notes_fts(rowid,title,body) VALUES(?,?,?)').run(id, title, body);
    q('DELETE FROM note_links WHERE from_id=?').run(id); for (const t of extractLinks(body)) q('INSERT INTO note_links(from_id,target) VALUES(?,?)').run(id, t);
  };
  const parsed = (b) => { const r = validateNote(b); if (r.errors) throw new HttpError(422, 'Validation failed', r.errors); return r.value; };
  const dupCheck = (title, exceptId) => { const d = q('SELECT id FROM notes WHERE title=? COLLATE NOCASE').get(title); if (d && d.id !== exceptId) throw new HttpError(422, 'Validation failed', { title: `A note titled "${title}" already exists` }); };
  function detail(id) {
    const n = get404(id), links = extractLinksFromRows(id);
    const backlinks = q('SELECT n.id, n.title FROM note_links l JOIN notes n ON n.id = l.from_id WHERE l.target = ? COLLATE NOCASE AND l.from_id <> ? ORDER BY n.title COLLATE NOCASE').all(n.title.toLowerCase(), id);
    return { id: n.id, title: n.title, body: n.body, createdAt: n.created_at, updatedAt: n.updated_at, backlinks, links };
  }
  // Map of every link target in this note -> {title, id|null}; ids resolve case-insensitively.
  function extractLinksFromRows(id) {
    return q('SELECT l.target, n.id, n.title FROM note_links l LEFT JOIN notes n ON n.title = l.target COLLATE NOCASE WHERE l.from_id=? ORDER BY l.rowid').all(id).map((r) => ({ target: r.target, id: r.id ?? null, title: r.title ?? null }));
  }

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'resolve' && m === 'GET') { const r = q('SELECT id, title FROM notes WHERE title=? COLLATE NOCASE').get((sp.get('title') || '').trim()); return { body: r ?? null }; }
    if (p[0] !== 'notes') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') {
        const fts = toFtsQuery(sp.get('q'));
        if (sp.get('q') && sp.get('q').trim() && !fts) return { body: [] };
        const rows = fts ? q("SELECT n.id, n.title, n.updated_at, snippet(notes_fts, 1, char(1), char(2), '…', 12) hl FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts, 8.0, 1.0) LIMIT 100").all(fts)
          : q('SELECT id, title, updated_at, substr(body,1,120) hl FROM notes ORDER BY updated_at DESC, id DESC LIMIT 500').all();
        return { body: rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, excerpt: String(r.hl).replace(/[\u0001\u0002]/g, fts ? '' : '').replace(/\s+/g, ' ').trim(), match: !!fts })) };
      }
      if (m === 'POST') { const v = parsed(await readBody(req)); dupCheck(v.title); const id = tx(() => { const id = Number(q('INSERT INTO notes(title,body) VALUES(?,?)').run(v.title, v.body).lastInsertRowid); reindex(id, v.title, v.body); return id; }); return { status: 201, body: detail(id) }; }
      throw new HttpError(405, 'Method not allowed');
    }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
    const note = get404(id);
    if (m === 'GET') return { body: detail(id) };
    if (m === 'PUT') {
      const v = parsed(await readBody(req)); dupCheck(v.title, id);
      tx(() => {
        q("UPDATE notes SET title=?, body=?, updated_at=datetime('now') WHERE id=?").run(v.title, v.body, id); reindex(id, v.title, v.body);
        if (v.title.toLowerCase() !== note.title.toLowerCase() || v.title !== note.title) {   // rewrite [[old]] in every other note
          for (const r of q('SELECT n.id, n.title, n.body FROM note_links l JOIN notes n ON n.id = l.from_id WHERE l.target = ? AND n.id <> ?').all(note.title.toLowerCase(), id)) {
            const nb = renameLinks(r.body, note.title, v.title); if (nb !== r.body) { q("UPDATE notes SET body=?, updated_at=datetime('now') WHERE id=?").run(nb, r.id); reindex(r.id, r.title, nb); }
          }
        }
      });
      return { body: detail(id) };
    }
    if (m === 'DELETE') { tx(() => { q('DELETE FROM notes_fts WHERE rowid=?').run(id); q('DELETE FROM notes WHERE id=?').run(id); }); return { status: 204 }; }
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/linkpad.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Linkpad listening on :${port}`));
}
