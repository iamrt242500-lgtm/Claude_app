import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { isDate, addDays, pagesPerDay, mergeDays, rate, eta, streak, longestStreak, goalPace } from './reading.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE books(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120), author TEXT NOT NULL DEFAULT '' CHECK(length(author) <= 80), total_pages INTEGER NOT NULL CHECK(total_pages BETWEEN 1 AND 20000), finished_day TEXT, rating INTEGER CHECK(rating IS NULL OR rating BETWEEN 1 AND 5), added_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE logs(book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE, day TEXT NOT NULL, page INTEGER NOT NULL CHECK(page >= 0), PRIMARY KEY(book_id, day)) WITHOUT ROWID;
    CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id = 1), goal INTEGER NOT NULL); INSERT INTO settings VALUES(1, 12);
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
  const todayOf = (sp) => { const utc = now().toISOString().slice(0, 10), c = sp?.get('today'); return c && isDate(c) && Math.abs(Date.parse(c + 'T00:00:00Z') - Date.parse(utc + 'T00:00:00Z')) <= 86400000 ? c : utc; };
  const book = (id) => { const b = q('SELECT * FROM books WHERE id=?').get(id); if (!b) throw new HttpError(404, 'Book not found'); return b; };
  const logsOf = (id) => q('SELECT day, page FROM logs WHERE book_id=? ORDER BY day').all(id);
  function dto(b, today) {
    const logs = logsOf(b.id), cur = logs.length ? logs[logs.length - 1].page : 0, per = pagesPerDay(logs), r = rate(per, today, 14), remaining = b.total_pages - cur;
    return { id: b.id, title: b.title, author: b.author, totalPages: b.total_pages, page: cur, percent: Math.floor((cur / b.total_pages) * 100), finishedDay: b.finished_day, rating: b.rating, status: b.finished_day ? 'finished' : cur > 0 ? 'reading' : 'to-read', pagesPerDay: Math.round(r * 10) / 10, eta: b.finished_day ? null : eta(remaining, r, today) };
  }
  /** Finished the first day a log reaches the last page. */
  const refreshFinish = (id) => { const b = book(id), f = q('SELECT MIN(day) d FROM logs WHERE book_id=? AND page>=?').get(id, b.total_pages)?.d ?? null; q('UPDATE books SET finished_day=? WHERE id=?').run(f, id); };
  function bookIn(b, prev) {
    const d = {}, title = (b.title ?? prev?.title ?? '').toString().trim(), author = (b.author ?? prev?.author ?? '').toString().trim(), pages = b.totalPages ?? prev?.total_pages, rating = b.rating === undefined ? prev?.rating ?? null : b.rating;
    if (!title || title.length > 120) d.title = 'Title is required (max 120 characters)'; if (author.length > 80) d.author = 'Author must be ≤ 80 characters'; if (!Number.isInteger(pages) || pages < 1 || pages > 20000) d.totalPages = 'Pages must be a whole number from 1 to 20,000'; if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) d.rating = 'Rating must be 1–5 or empty';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { title, author, pages, rating };
  }
  function stats(today) {
    const books = q('SELECT * FROM books').all(), maps = books.map((b) => pagesPerDay(logsOf(b.id))), all = mergeDays(maps), year = today.slice(0, 4), goal = q('SELECT goal FROM settings').get().goal;
    const series = Array.from({ length: 30 }, (_, i) => { const day = addDays(today, i - 29); return { day, pages: all.get(day) || 0 }; }), finished = books.filter((b) => b.finished_day?.startsWith(year));
    let yearPages = 0; for (const [d, n] of all) if (d.startsWith(year)) yearPages += n;
    return { today, series, pagesLast30: series.reduce((s, x) => s + x.pages, 0), rate14: Math.round(rate(all, today, 14) * 10) / 10, streak: streak(all, today), longestStreak: longestStreak(all), yearPages, finishedThisYear: finished.length, goal, pace: goalPace(goal, finished.length, today), reading: books.filter((b) => !b.finished_day && logsOf(b.id).length).length };
  }
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams, today = todayOf(sp);
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'stats' && m === 'GET') return { body: stats(today) };
    if (p[0] === 'goal' && m === 'PUT') { const b = await readBody(req); if (!Number.isInteger(b.goal) || b.goal < 1 || b.goal > 1000) throw new HttpError(422, 'Validation failed', { goal: 'Goal must be a whole number from 1 to 1000' }); q('UPDATE settings SET goal=? WHERE id=1').run(b.goal); return { body: stats(today) }; }
    if (p[0] === 'books') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM books ORDER BY finished_day IS NOT NULL, added_at DESC, id DESC').all().map((b) => dto(b, today)) };
      if (p.length === 1 && m === 'POST') { const v = bookIn(await readBody(req)); const r = q('INSERT INTO books(title,author,total_pages,rating) VALUES(?,?,?,?)').run(v.title, v.author, v.pages, v.rating); return { status: 201, body: dto(book(Number(r.lastInsertRowid)), today) }; }
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const b = book(id);
      if (p.length === 2 && m === 'GET') return { body: { ...dto(b, today), logs: logsOf(id).map((l, i, a) => ({ ...l, pages: Math.max(0, l.page - (i ? a[i - 1].page : 0)) })).reverse() } };
      if (p.length === 2 && m === 'PATCH') { const v = bookIn(await readBody(req), b); const cur = q('SELECT MAX(page) mx FROM logs WHERE book_id=?').get(id).mx || 0; if (v.pages < cur) throw new HttpError(422, 'Validation failed', { totalPages: `A page ${cur} is already logged — pages can't be fewer than that` }); q('UPDATE books SET title=?, author=?, total_pages=?, rating=? WHERE id=?').run(v.title, v.author, v.pages, v.rating, id); refreshFinish(id); return { body: dto(book(id), today) }; }
      if (p.length === 2 && m === 'DELETE') { q('DELETE FROM books WHERE id=?').run(id); return { status: 204 }; }
      if (p[2] === 'log' && m === 'PUT') {
        const bd = await readBody(req), d = {}, day = bd.day ?? today; if (!isDate(day) || day < '2000-01-01') d.day = 'Date must be a valid YYYY-MM-DD'; else if (day > today) d.day = 'You can’t log a future day';
        if (!Number.isInteger(bd.page) || bd.page < 0 || bd.page > b.total_pages) d.page = `Page must be a whole number from 0 to ${b.total_pages}`; if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
        q('INSERT INTO logs(book_id,day,page) VALUES(?,?,?) ON CONFLICT(book_id,day) DO UPDATE SET page=excluded.page').run(id, day, bd.page); refreshFinish(id); return { body: dto(book(id), today) };
      }
      if (p[2] === 'log' && p[3] && m === 'DELETE') { if (!isDate(p[3])) throw new HttpError(400, 'Invalid date'); const r = q('DELETE FROM logs WHERE book_id=? AND day=?').run(id, p[3]); if (!r.changes) throw new HttpError(404, 'No log for that day'); refreshFinish(id); return { body: dto(book(id), today) }; }
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
      if (e instanceof HttpError) { if (e.status === 413) res.setHeader('Connection', 'close'); return send(e.status, JSON.stringify({ error: e.message, details: e.details })); }
      if (e instanceof URIError) return send(400, JSON.stringify({ error: 'Bad request' }));
      console.error(e); send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/pagewise.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Pagewise listening on :${port}`));
}
