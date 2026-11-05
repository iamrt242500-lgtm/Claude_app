import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { toFtsQuery, validateSnippet, splitHighlight, LIMITS } from './logic.js';

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
    CREATE TABLE snippets(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, language TEXT NOT NULL, code TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)), created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE snippet_tags(snippet_id INTEGER NOT NULL REFERENCES snippets(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(snippet_id, tag)) WITHOUT ROWID;
    CREATE INDEX idx_snippet_tags_tag ON snippet_tags(tag);
    CREATE VIRTUAL TABLE snippet_fts USING fts5(title, code, notes, tags, tokenize='porter unicode61');
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req, max = 3_000_000) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > max) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const dto = (r, highlight) => ({ id: r.id, title: r.title, language: r.language, code: r.code, notes: r.notes, tags: JSON.parse(r.tags), pinned: !!r.pinned, createdAt: r.created_at, updatedAt: r.updated_at, ...(highlight ? { highlight: splitHighlight(highlight) } : {}) });
  const get404 = (id) => { const r = q('SELECT * FROM snippets WHERE id=?').get(id); if (!r) throw new HttpError(404, 'Snippet not found'); return r; };
  const index = (id, v) => { q('DELETE FROM snippet_fts WHERE rowid=?').run(id); q('INSERT INTO snippet_fts(rowid,title,code,notes,tags) VALUES(?,?,?,?,?)').run(id, v.title, v.code, v.notes, v.tags.join(' ')); q('DELETE FROM snippet_tags WHERE snippet_id=?').run(id); v.tags.forEach((t) => q('INSERT INTO snippet_tags(snippet_id,tag) VALUES(?,?)').run(id, t)); };
  const insert = (v) => { const id = Number(q('INSERT INTO snippets(title,language,code,notes,tags) VALUES(?,?,?,?,?)').run(v.title, v.language, v.code, v.notes, JSON.stringify(v.tags)).lastInsertRowid); index(id, v); return id; };
  const parsed = (b) => { const r = validateSnippet(b); if (r.errors) throw new HttpError(422, 'Validation failed', r.errors); return r.value; };

  function list(sp) {
    const where = [], args = []; let join_ = '', order = 'ORDER BY s.pinned DESC, s.updated_at DESC, s.id DESC', sel = 's.*';
    const fts = toFtsQuery(sp.get('q'));
    if (sp.get('q') && sp.get('q').trim() && !fts) return [];
    if (fts) { join_ = 'JOIN snippet_fts f ON f.rowid = s.id'; where.push('snippet_fts MATCH ?'); args.push(fts); sel = "s.*, snippet(snippet_fts, 1, char(1), char(2), '…', 14) AS hl, snippet(snippet_fts, 0, char(1), char(2), '…', 8) AS hl_title"; order = 'ORDER BY bm25(snippet_fts, 8.0, 2.0, 1.0, 4.0), s.pinned DESC'; }
    if (sp.get('tag')) { where.push('EXISTS (SELECT 1 FROM snippet_tags t WHERE t.snippet_id = s.id AND t.tag = ?)'); args.push(sp.get('tag')); }
    if (sp.get('language')) { where.push('s.language = ?'); args.push(sp.get('language')); }
    if (sp.get('pinned') === '1') where.push('s.pinned = 1');
    const rows = q(`SELECT ${sel} FROM snippets s ${join_} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${order} LIMIT 200`).all(...args);
    return rows.map((r) => dto(r, fts ? r.hl : null));
  }

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'tags' && m === 'GET') return { body: { tags: q('SELECT tag, COUNT(*) count FROM snippet_tags GROUP BY tag ORDER BY count DESC, tag').all(), languages: q('SELECT language, COUNT(*) count FROM snippets GROUP BY language ORDER BY count DESC, language').all(), total: q('SELECT COUNT(*) n FROM snippets').get().n } };
    if (p[0] === 'export' && m === 'GET') return { body: { version: 1, snippets: q('SELECT * FROM snippets ORDER BY id').all().map((r) => { const d = dto(r); return { title: d.title, language: d.language, code: d.code, notes: d.notes, tags: d.tags }; }) }, headers: { 'Content-Disposition': 'attachment; filename="snipbox.json"' } };
    if (p[0] === 'import' && m === 'POST') {
      const b = await readBody(req, 6_000_000); const arr = Array.isArray(b) ? b : b.snippets;
      if (!Array.isArray(arr)) throw new HttpError(422, 'Validation failed', { snippets: 'Expected {"snippets": [...]}' });
      if (arr.length > LIMITS.import) throw new HttpError(422, 'Validation failed', { snippets: `Too many snippets (max ${LIMITS.import})` });
      const errors = []; let imported = 0;
      tx(() => arr.forEach((x, i) => { const r = validateSnippet(x); if (r.errors) errors.push({ index: i, errors: r.errors }); else { insert(r.value); imported++; } }));
      return { status: 201, body: { imported, skipped: errors.length, errors: errors.slice(0, 20) } };
    }
    if (p[0] !== 'snippets') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') return { body: list(url.searchParams) };
      if (m === 'POST') { const v = parsed(await readBody(req)); return { status: 201, body: dto(get404(tx(() => insert(v)))) }; }
      throw new HttpError(405, 'Method not allowed');
    }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
    const row = get404(id);
    if (p.length === 2) {
      if (m === 'GET') return { body: dto(row) };
      if (m === 'PUT') { const v = parsed(await readBody(req)); tx(() => { q("UPDATE snippets SET title=?, language=?, code=?, notes=?, tags=?, updated_at=datetime('now') WHERE id=?").run(v.title, v.language, v.code, v.notes, JSON.stringify(v.tags), id); index(id, v); }); return { body: dto(get404(id)) }; }
      if (m === 'DELETE') { tx(() => { q('DELETE FROM snippet_fts WHERE rowid=?').run(id); q('DELETE FROM snippets WHERE id=?').run(id); }); return { status: 204 }; }
    }
    if (p[2] === 'pin' && m === 'POST') { const b = await readBody(req); if (typeof b.pinned !== 'boolean') throw new HttpError(422, 'Validation failed', { pinned: 'pinned must be true or false' }); q('UPDATE snippets SET pinned=? WHERE id=?').run(b.pinned ? 1 : 0, id); return { body: dto(get404(id)) }; }
    throw new HttpError(405, 'Method not allowed');
  }

  const server = createServer(async (req, res) => {
    const send = (s, b, t = 'application/json; charset=utf-8', h = {}) => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store', ...h }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body), undefined, r.headers); }
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/snipbox.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Snipbox listening on :${port}`));
}
