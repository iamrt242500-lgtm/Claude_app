import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { score, dayIndex } from './game.js';
import { ANSWERS, EXTRA } from './words.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const VALID = new Set([...ANSWERS, ...EXTRA]), MAX_GUESSES = 6;
/** 7919 is prime and does not divide the list length, so this walks the whole list before repeating. */
export const answerFor = (day) => ANSWERS[(((day * 7919 + 13) % ANSWERS.length) + ANSWERS.length) % ANSWERS.length];

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE games(pid TEXT NOT NULL, day INTEGER NOT NULL, guesses TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'playing' CHECK(status IN ('playing','won','lost')), PRIMARY KEY(pid, day)) WITHOUT ROWID;
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 2_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function stats(rows, today) {
  const done = rows.filter((r) => r.status !== 'playing'), won = done.filter((r) => r.status === 'won'), dist = Array(MAX_GUESSES).fill(0);
  for (const r of won) dist[JSON.parse(r.guesses).length - 1]++;
  const wonDays = new Set(won.map((r) => r.day)); let current = 0, d = wonDays.has(today) ? today : today - 1; while (wonDays.has(d)) { current++; d--; }
  let max = 0, run = 0, prev = null; for (const day of [...wonDays].sort((a, b) => a - b)) { run = prev !== null && day === prev + 1 ? run + 1 : 1; max = Math.max(max, run); prev = day; }
  return { played: done.length, won: won.length, winRate: done.length ? Math.round((won.length / done.length) * 100) : 0, currentStreak: current, maxStreak: max, distribution: dist };
}

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const todayOf = (sp) => { const utc = now().toISOString().slice(0, 10), c = sp.get('today'); return c && isDate(c) && Math.abs(Date.parse(c + 'T00:00:00Z') - Date.parse(utc + 'T00:00:00Z')) <= 86400000 ? c : utc; };
  const pidOf = (req) => { const m = /(?:^|;\s*)pid=([a-f0-9]{32})/.exec(req.headers.cookie || ''); return m ? { pid: m[1], fresh: false } : { pid: randomBytes(16).toString('hex'), fresh: true }; };
  const game = (pid, day) => q('SELECT * FROM games WHERE pid=? AND day=?').get(pid, day) || { pid, day, guesses: '[]', status: 'playing' };
  const dto = (g) => { const ans = answerFor(g.day), guesses = JSON.parse(g.guesses); return { day: g.day, status: g.status, maxGuesses: MAX_GUESSES, rows: guesses.map((w) => ({ guess: w, result: score(w, ans) })), answer: g.status === 'lost' ? ans : null }; };

  async function api(req, url, ctx) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams, date = todayOf(sp), day = dayIndex(date);
    if (p[0] === 'health') return { body: { ok: true } };
    const { pid, fresh } = pidOf(req); if (fresh) ctx.cookie = `pid=${pid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
    if (p[0] === 'today' && m === 'GET') return { body: { date, ...dto(game(pid, day)) } };
    if (p[0] === 'stats' && m === 'GET') return { body: stats(q('SELECT * FROM games WHERE pid=?').all(pid), day) };
    if (p[0] === 'guess' && m === 'POST') {
      const b = await readBody(req), w = typeof b.guess === 'string' ? b.guess.trim().toLowerCase() : '', g = game(pid, day);
      if (g.status !== 'playing') throw new HttpError(409, 'Today’s game is already finished');
      if (!/^[a-z]{5}$/.test(w)) throw new HttpError(422, 'Validation failed', { guess: 'Enter a 5-letter word' });
      if (!VALID.has(w)) throw new HttpError(422, 'Validation failed', { guess: 'Not in the word list' });
      const guesses = JSON.parse(g.guesses); if (guesses.includes(w)) throw new HttpError(422, 'Validation failed', { guess: 'You already tried that word' });
      guesses.push(w); const status = w === answerFor(day) ? 'won' : guesses.length >= MAX_GUESSES ? 'lost' : 'playing';
      q('INSERT INTO games(pid,day,guesses,status) VALUES(?,?,?,?) ON CONFLICT(pid,day) DO UPDATE SET guesses=excluded.guesses, status=excluded.status').run(pid, day, JSON.stringify(guesses), status);
      return { body: { date, ...dto({ pid, day, guesses: JSON.stringify(guesses), status }) } };
    }
    throw new HttpError(404, 'Not found');
  }
  const server = createServer(async (req, res) => {
    const ctx = {}, send = (s, b, t = 'application/json; charset=utf-8') => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store', ...(ctx.cookie ? { 'Set-Cookie': ctx.cookie } : {}) }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url, ctx); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body)); }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel.includes('..')) throw new HttpError(404, 'Not found');
      if (rel === 'game.js') return send(200, await readFile(join(SRC, 'game.js')), MIME['.js']);   // scoring is shared; the word list is NOT
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/lexi.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Lexi listening on :${port}`));
}
