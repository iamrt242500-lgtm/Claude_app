import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { parseCsv } from './csv.js';
import { profileColumn, uniqueHeaders, aggregate } from './profile.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
export const LIMITS = { bytes: 5_000_000, rows: 50_000, cols: 100 };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE datasets(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100), delimiter TEXT NOT NULL, row_count INTEGER NOT NULL, columns TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE data_rows(dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(dataset_id, idx)) WITHOUT ROWID;
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > LIMITS.bytes + 100_000) throw new HttpError(413, `Payload too large (max ${LIMITS.bytes / 1e6} MB)`); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const meta = (d) => ({ id: d.id, name: d.name, delimiter: d.delimiter, rowCount: d.row_count, createdAt: d.created_at, columns: JSON.parse(d.columns) });
  const get = (id) => { const d = q('SELECT * FROM datasets WHERE id=?').get(id); if (!d) throw new HttpError(404, 'Dataset not found'); return d; };
  const rowsOf = (id, headers) => q('SELECT data FROM data_rows WHERE dataset_id=? ORDER BY idx').all(id).map((r) => { const a = JSON.parse(r.data); return Object.fromEntries(headers.map((h, i) => [h, a[i] ?? ''])); });

  function create(b) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 100) throw new HttpError(422, 'Validation failed', { name: 'Name is required (max 100 characters)' });
    if (typeof b.csv !== 'string' || !b.csv.trim()) throw new HttpError(422, 'Validation failed', { csv: 'CSV content is required' });
    if (Buffer.byteLength(b.csv) > LIMITS.bytes) throw new HttpError(413, `CSV too large (max ${LIMITS.bytes / 1e6} MB)`);
    let parsed;
    try { parsed = parseCsv(b.csv, b.delimiter); } catch (e) { throw new HttpError(422, 'Validation failed', { csv: e.message }); }
    const [head, ...body] = parsed.rows;
    if (!head || head.length < 1 || !body.length) throw new HttpError(422, 'Validation failed', { csv: 'Need a header row and at least one data row' });
    if (head.length > LIMITS.cols) throw new HttpError(422, 'Validation failed', { csv: `Too many columns (max ${LIMITS.cols})` });
    if (body.length > LIMITS.rows) throw new HttpError(422, 'Validation failed', { csv: `Too many rows (max ${LIMITS.rows})` });
    const headers = uniqueHeaders(head);
    const norm = body.map((r) => headers.map((_, i) => r[i] ?? ''));
    const columns = headers.map((h, i) => profileColumn(h, norm.map((r) => r[i])));
    db.exec('BEGIN');
    try {
      const r = q('INSERT INTO datasets(name,delimiter,row_count,columns) VALUES(?,?,?,?)').run(name, parsed.delimiter, norm.length, JSON.stringify(columns));
      const id = Number(r.lastInsertRowid), ins = q('INSERT INTO data_rows(dataset_id,idx,data) VALUES(?,?,?)');
      norm.forEach((row, i) => ins.run(id, i, JSON.stringify(row)));
      db.exec('COMMIT'); return meta(get(id));
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] !== 'datasets') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') return { body: q('SELECT id,name,row_count,columns,created_at FROM datasets ORDER BY id DESC').all().map((d) => ({ id: d.id, name: d.name, rowCount: d.row_count, columnCount: JSON.parse(d.columns).length, createdAt: d.created_at })) };
      if (m === 'POST') return { status: 201, body: create(await readBody(req)) };
      throw new HttpError(405, 'Method not allowed');
    }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
    const d = get(id), info = meta(d), headers = info.columns.map((c) => c.name);
    if (p.length === 2) {
      if (m === 'GET') return { body: info };
      if (m === 'DELETE') { q('DELETE FROM datasets WHERE id=?').run(id); return { status: 204 }; }
    }
    if (p[2] === 'rows' && m === 'GET') {
      const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 25)), offset = Math.max(0, Number(sp.get('offset')) || 0);
      const search = (sp.get('q') || '').toLowerCase(), sort = sp.get('sort'), dir = sp.get('dir') === 'desc' ? -1 : 1;
      let rows = rowsOf(id, headers);
      if (search) rows = rows.filter((r) => headers.some((h) => String(r[h]).toLowerCase().includes(search)));
      if (sort) {
        if (!headers.includes(sort)) throw new HttpError(400, 'Unknown sort column');
        const num = info.columns.find((c) => c.name === sort).type === 'number';
        rows.sort((a, b) => dir * (num ? Number(String(a[sort]).replace(/,/g, '')) - Number(String(b[sort]).replace(/,/g, '')) || 0 : String(a[sort]).localeCompare(String(b[sort]))));
      }
      return { body: { total: rows.length, offset, limit, rows: rows.slice(offset, offset + limit) } };
    }
    if (p[2] === 'aggregate' && m === 'GET') {
      try { return { body: aggregate(rowsOf(id, headers), info.columns, { group: sp.get('group'), metric: sp.get('metric'), fn: sp.get('fn') || 'count' }).slice(0, 50) }; }
      catch (e) { if (e instanceof RangeError) throw new HttpError(422, e.message); throw e; }
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/tabula.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Tabula listening on :${port}`));
}
