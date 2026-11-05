import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { schedule, parseBulk } from './sm2.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const utcToday = () => new Date().toISOString().slice(0, 10);

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) {
    db.exec(`BEGIN; CREATE TABLE decks(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), created_at TEXT NOT NULL DEFAULT(datetime('now')));
      CREATE TABLE cards(id INTEGER PRIMARY KEY AUTOINCREMENT, deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        front TEXT NOT NULL CHECK(length(front) BETWEEN 1 AND 1000), back TEXT NOT NULL CHECK(length(back) BETWEEN 1 AND 2000),
        ease REAL NOT NULL DEFAULT 2.5, reps INTEGER NOT NULL DEFAULT 0, interval INTEGER NOT NULL DEFAULT 0, due TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')));
      CREATE INDEX idx_cards_deck_due ON cards(deck_id, due);
      CREATE TABLE reviews(id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 4), day TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
  }
  return db;
}

async function body(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 200_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const text = (v, field, max) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new HttpError(422, 'Validation failed', { [field]: `${field} is required` });
  if (s.length > max) throw new HttpError(422, 'Validation failed', { [field]: `${field} must be ≤ ${max} characters` });
  return s;
};
const dto = (c) => ({ id: c.id, deckId: c.deck_id, front: c.front, back: c.back, ease: c.ease, reps: c.reps, interval: c.interval, due: c.due });

export function createApp({ dbPath = ':memory:', today = utcToday } = {}) {
  const db = openDb(dbPath);
  const q = (s) => db.prepare(s);
  const deckOr404 = (id) => { const d = q('SELECT * FROM decks WHERE id=?').get(id); if (!d) throw new HttpError(404, 'Deck not found'); return d; };
  const cardOr404 = (id) => { const c = q('SELECT * FROM cards WHERE id=?').get(id); if (!c) throw new HttpError(404, 'Card not found'); return c; };
  const withTx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, T = today();
    const id = p[1] !== undefined ? Number(p[1]) : null;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'stats' && m === 'GET') {
      const t = q('SELECT COUNT(*) n, SUM(due<=?) due FROM cards').get(T);
      const r = q('SELECT COUNT(*) n, SUM(grade>=2) ok FROM reviews').get();
      const td = q('SELECT COUNT(*) n FROM reviews WHERE day=?').get(T).n;
      const days = q("SELECT day, COUNT(*) n FROM reviews GROUP BY day ORDER BY day DESC LIMIT 14").all().reverse();
      return { body: { cards: t.n, due: t.due ?? 0, reviews: r.n, reviewedToday: td, retention: r.n ? Math.round((r.ok / r.n) * 100) : null, days } };
    }
    if (p[0] === 'decks') {
      if (p.length === 1) {
        if (m === 'GET') return { body: q('SELECT d.id, d.name, COUNT(c.id) cards, COALESCE(SUM(c.due<=?),0) due FROM decks d LEFT JOIN cards c ON c.deck_id=d.id GROUP BY d.id ORDER BY d.name COLLATE NOCASE').all(T) };
        if (m === 'POST') {
          const name = text((await body(req)).name, 'name', 80);
          const r = q('INSERT INTO decks(name) VALUES(?)').run(name);
          return { status: 201, body: { id: Number(r.lastInsertRowid), name, cards: 0, due: 0 } };
        }
      } else {
        if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
        const deck = deckOr404(id), sub = p[2];
        if (!sub && m === 'GET') return { body: { id: deck.id, name: deck.name, cards: q('SELECT * FROM cards WHERE deck_id=? ORDER BY id DESC').all(id).map(dto) } };
        if (!sub && m === 'DELETE') { q('DELETE FROM decks WHERE id=?').run(id); return { status: 204 }; }
        if (sub === 'cards' && m === 'POST') {
          const b = await body(req);
          if (typeof b.bulk === 'string') {
            const { cards, bad } = parseBulk(b.bulk);
            if (bad.length || !cards.length) throw new HttpError(422, 'Validation failed', { bulk: bad.length ? `Lines without "front :: back": ${bad.join(', ')}` : 'Nothing to import' });
            if (cards.length > 500) throw new HttpError(422, 'Validation failed', { bulk: 'Max 500 cards per import' });
            if (cards.some((c) => c.front.length > 1000 || c.back.length > 2000)) throw new HttpError(422, 'Validation failed', { bulk: 'A card is too long' });
            withTx(() => cards.forEach((c) => q('INSERT INTO cards(deck_id,front,back,due) VALUES(?,?,?,?)').run(id, c.front, c.back, T)));
            return { status: 201, body: { imported: cards.length } };
          }
          const front = text(b.front, 'front', 1000), back = text(b.back, 'back', 2000);
          const r = q('INSERT INTO cards(deck_id,front,back,due) VALUES(?,?,?,?)').run(id, front, back, T);
          return { status: 201, body: dto(q('SELECT * FROM cards WHERE id=?').get(Number(r.lastInsertRowid))) };
        }
        if (sub === 'study' && m === 'GET') {
          const rows = q('SELECT * FROM cards WHERE deck_id=? AND due<=? ORDER BY due, id LIMIT 50').all(id, T);
          return { body: rows.map(dto) };
        }
      }
    }
    if (p[0] === 'cards' && Number.isInteger(id) && id > 0) {
      const c = cardOr404(id);
      if (p.length === 2 && m === 'PUT') {
        const b = await body(req);
        q('UPDATE cards SET front=?, back=? WHERE id=?').run(text(b.front, 'front', 1000), text(b.back, 'back', 2000), id);
        return { body: dto(cardOr404(id)) };
      }
      if (p.length === 2 && m === 'DELETE') { q('DELETE FROM cards WHERE id=?').run(id); return { status: 204 }; }
      if (p[2] === 'grade' && m === 'POST') {
        const grade = Number((await body(req)).grade);
        if (![1, 2, 3, 4].includes(grade)) throw new HttpError(422, 'Validation failed', { grade: 'grade must be 1-4' });
        const s = schedule(c, grade, T);
        withTx(() => { q('UPDATE cards SET ease=?, reps=?, interval=?, due=? WHERE id=?').run(s.ease, s.reps, s.interval, s.due, id); q('INSERT INTO reviews(card_id,grade,day) VALUES(?,?,?)').run(id, grade, T); });
        return { body: dto(cardOr404(id)) };
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/recall.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Recall listening on :${port}`));
}
