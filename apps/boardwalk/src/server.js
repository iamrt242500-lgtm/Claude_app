import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { reorder, normalizeLabels, isDate } from './order.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const MAX_COLUMNS = 12;

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE boards(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE columns(id INTEGER PRIMARY KEY AUTOINCREMENT, board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40), position INTEGER NOT NULL);
    CREATE TABLE cards(id INTEGER PRIMARY KEY AUTOINCREMENT, column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
      description TEXT NOT NULL DEFAULT '', due TEXT, labels TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE INDEX idx_columns_board ON columns(board_id, position); CREATE INDEX idx_cards_column ON cards(column_id, position);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 100_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const name = (v, max, field = 'name') => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new HttpError(422, 'Validation failed', { [field]: `${field[0].toUpperCase() + field.slice(1)} is required` });
  if (s.length > max) throw new HttpError(422, 'Validation failed', { [field]: `${field[0].toUpperCase() + field.slice(1)} must be ≤ ${max} characters` });
  return s;
};

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const board404 = (id) => { const b = q('SELECT * FROM boards WHERE id=?').get(id); if (!b) throw new HttpError(404, 'Board not found'); return b; };
  const col404 = (id) => { const c = q('SELECT * FROM columns WHERE id=?').get(id); if (!c) throw new HttpError(404, 'Column not found'); return c; };
  const card404 = (id) => { const c = q('SELECT * FROM cards WHERE id=?').get(id); if (!c) throw new HttpError(404, 'Card not found'); return c; };
  const cardDto = (c) => ({ id: c.id, columnId: c.column_id, title: c.title, description: c.description, due: c.due, labels: JSON.parse(c.labels), position: c.position });
  const boardFull = (id) => {
    const b = board404(id);
    const columns = q('SELECT * FROM columns WHERE board_id=? ORDER BY position').all(id).map((c) => ({ id: c.id, name: c.name, cards: q('SELECT * FROM cards WHERE column_id=? ORDER BY position').all(c.id).map(cardDto) }));
    return { id: b.id, name: b.name, columns };
  };
  const cardIn = (b) => {
    const title = name(b.title, 200, 'title'), description = typeof b.description === 'string' ? b.description.trim() : '';
    const d = {}; if (description.length > 5000) d.description = 'Description too long (max 5000)';
    const due = b.due ? b.due : null; if (due && !isDate(due)) d.due = 'Invalid due date';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
    return { title, description, due, labels: normalizeLabels(b.labels) };
  };
  const renumber = (colId, ids) => ids.forEach((id, i) => q('UPDATE cards SET column_id=?, position=? WHERE id=?').run(colId, i, id));
  const ids = (colId) => q('SELECT id FROM cards WHERE column_id=? ORDER BY position, id').all(colId).map((r) => r.id);

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    const id = p[1] !== undefined ? Number(p[1]) : null;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[1] !== undefined && (!Number.isInteger(id) || id < 1)) throw new HttpError(400, 'Invalid id');
    if (p[0] === 'boards') {
      if (p.length === 1) {
        if (m === 'GET') return { body: q('SELECT b.id, b.name, (SELECT COUNT(*) FROM cards c JOIN columns k ON c.column_id=k.id WHERE k.board_id=b.id) cards FROM boards b ORDER BY b.id DESC').all() };
        if (m === 'POST') {
          const n = name((await readBody(req)).name, 80);
          const bid = tx(() => { const bid = Number(q('INSERT INTO boards(name) VALUES(?)').run(n).lastInsertRowid); ['To do', 'Doing', 'Done'].forEach((c, i) => q('INSERT INTO columns(board_id,name,position) VALUES(?,?,?)').run(bid, c, i)); return bid; });
          return { status: 201, body: boardFull(bid) };
        }
      } else if (p.length === 2) {
        if (m === 'GET') return { body: boardFull(id) };
        if (m === 'PUT') { board404(id); q('UPDATE boards SET name=? WHERE id=?').run(name((await readBody(req)).name, 80), id); return { body: boardFull(id) }; }
        if (m === 'DELETE') { board404(id); q('DELETE FROM boards WHERE id=?').run(id); return { status: 204 }; }
      } else if (p[2] === 'columns' && m === 'POST') {
        board404(id); const n = name((await readBody(req)).name, 40);
        const count = q('SELECT COUNT(*) n FROM columns WHERE board_id=?').get(id).n;
        if (count >= MAX_COLUMNS) throw new HttpError(409, `A board can have at most ${MAX_COLUMNS} columns`);
        q('INSERT INTO columns(board_id,name,position) VALUES(?,?,?)').run(id, n, count); return { status: 201, body: boardFull(id) };
      }
    }
    if (p[0] === 'columns' && id) {
      const col = col404(id);
      if (p.length === 2 && m === 'PUT') { q('UPDATE columns SET name=? WHERE id=?').run(name((await readBody(req)).name, 40), id); return { body: boardFull(col.board_id) }; }
      if (p.length === 2 && m === 'DELETE') {
        if (q('SELECT COUNT(*) n FROM columns WHERE board_id=?').get(col.board_id).n <= 1) throw new HttpError(409, 'A board needs at least one column');
        tx(() => { q('DELETE FROM columns WHERE id=?').run(id); q('SELECT id FROM columns WHERE board_id=? ORDER BY position').all(col.board_id).forEach((c, i) => q('UPDATE columns SET position=? WHERE id=?').run(i, c.id)); });
        return { body: boardFull(col.board_id) };
      }
      if (p[2] === 'cards' && m === 'POST') {
        const v = cardIn(await readBody(req));
        const r = q('INSERT INTO cards(column_id,title,description,due,labels,position) VALUES(?,?,?,?,?,?)').run(id, v.title, v.description, v.due, JSON.stringify(v.labels), ids(id).length);
        return { status: 201, body: cardDto(card404(Number(r.lastInsertRowid))) };
      }
    }
    if (p[0] === 'cards' && id) {
      const card = card404(id);
      if (p.length === 2 && m === 'PUT') { const v = cardIn(await readBody(req)); q('UPDATE cards SET title=?, description=?, due=?, labels=? WHERE id=?').run(v.title, v.description, v.due, JSON.stringify(v.labels), id); return { body: cardDto(card404(id)) }; }
      if (p.length === 2 && m === 'DELETE') { tx(() => { q('DELETE FROM cards WHERE id=?').run(id); renumber(card.column_id, ids(card.column_id)); }); return { status: 204 }; }
      if (p[2] === 'move' && m === 'POST') {
        const b = await readBody(req), target = col404(Number(b.columnId));
        const from = col404(card.column_id);
        if (target.board_id !== from.board_id) throw new HttpError(422, 'Validation failed', { columnId: 'Column belongs to another board' });
        if (b.index != null && !Number.isInteger(b.index)) throw new HttpError(422, 'Validation failed', { index: 'index must be an integer' });
        tx(() => {
          if (target.id !== card.column_id) { renumber(from.id, ids(from.id).filter((x) => x !== id)); renumber(target.id, [...ids(target.id), id]); }
          renumber(target.id, reorder(ids(target.id), id, b.index));
        });
        return { body: boardFull(target.board_id) };
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/boardwalk.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Boardwalk listening on :${port}`));
}
