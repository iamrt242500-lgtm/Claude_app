import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { generate, isBoard, conflicts, candidates, CLUES, EMPTY } from './sudoku.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const MAX_SECONDS = 7 * 86400;

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE games(id TEXT PRIMARY KEY, difficulty TEXT NOT NULL, board TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, hints INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'playing' CHECK(status IN ('playing','solved')), started_at TEXT NOT NULL DEFAULT(datetime('now')), solved_at TEXT) WITHOUT ROWID;
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 10_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
/** "medium-12345" → { difficulty, seed } or null */
export function parseId(id) { const m = /^(easy|medium|hard)-(\d{1,10})$/.exec(typeof id === 'string' ? id : ''); if (!m) return null; const seed = Number(m[2]); return seed <= 2147483647 ? { difficulty: m[1], seed } : null; }

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s), cache = new Map();
  const puzzle = (id) => { const p = parseId(id); if (!p) throw new HttpError(400, 'Invalid puzzle id'); if (!cache.has(id)) { if (cache.size >= 200) cache.delete(cache.keys().next().value); cache.set(id, generate(p.seed, p.difficulty)); } return cache.get(id); };
  const gameDto = (g, pz) => ({ id: g.id, difficulty: g.difficulty, puzzle: pz.puzzle, board: g.board, seconds: g.seconds, hints: g.hints, status: g.status });
  const boardIn = (b, pz) => { const d = {}; if (!isBoard(b)) d.board = 'Board must be 81 characters of 1-9 or .'; else for (let i = 0; i < 81; i++) if (pz.puzzle[i] !== EMPTY && b[i] !== pz.puzzle[i]) { d.board = 'Board changes a given cell'; break; } if (d.board) throw new HttpError(422, 'Validation failed', d); return b; };
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'puzzle' && m === 'GET') {
      const difficulty = sp.get('difficulty') || 'medium'; if (!CLUES[difficulty]) throw new HttpError(422, 'Validation failed', { difficulty: 'difficulty must be easy, medium or hard' });
      let seed; if (sp.get('daily')) { const t = sp.get('today'), utc = now().toISOString().slice(0, 10), date = t && isDate(t) && Math.abs(Date.parse(t) - Date.parse(utc)) <= 86400000 ? t : utc; seed = Number(date.replace(/-/g, '')); }
      else if (sp.has('seed')) { seed = Number(sp.get('seed')); if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new HttpError(422, 'Validation failed', { seed: 'seed must be a whole number from 0 to 2147483647' }); }
      else seed = Math.floor(Math.random() * 2147483647);
      const id = `${difficulty}-${seed}`, pz = puzzle(id); return { body: { id, difficulty, seed, clues: pz.clues, puzzle: pz.puzzle } };
    }
    if (p[0] === 'check' && m === 'POST') {
      const b = await readBody(req), pz = puzzle(b.id), board = boardIn(b.board, pz), wrong = []; for (let i = 0; i < 81; i++) if (board[i] !== EMPTY && board[i] !== pz.solution[i]) wrong.push(i);
      return { body: { conflicts: conflicts(board), wrong, complete: !board.includes(EMPTY), solved: board === pz.solution } };
    }
    if (p[0] === 'hint' && m === 'POST') {
      const b = await readBody(req), pz = puzzle(b.id), board = boardIn(b.board, pz); let best = -1, n = 10;
      for (let i = 0; i < 81; i++) if (board[i] !== pz.solution[i]) { const c = board[i] === EMPTY ? candidates(board, i).length : 9; if (c < n) { n = c; best = i; } }
      if (best < 0) throw new HttpError(409, 'Nothing left to hint — the board is solved');
      q('UPDATE games SET hints = hints + 1 WHERE id=? AND status=\'playing\'').run(b.id); return { body: { index: best, digit: pz.solution[best] } };
    }
    if (p[0] === 'games') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM games ORDER BY started_at DESC, id LIMIT 50').all().map((g) => gameDto(g, puzzle(g.id))) };
      if (p.length === 1 && m === 'POST') { const b = await readBody(req), pz = puzzle(b.id), pid = parseId(b.id); let g = q('SELECT * FROM games WHERE id=?').get(b.id), created = false; if (!g) { q('INSERT INTO games(id,difficulty,board) VALUES(?,?,?)').run(b.id, pid.difficulty, pz.puzzle); g = q('SELECT * FROM games WHERE id=?').get(b.id); created = true; } return { status: created ? 201 : 200, body: gameDto(g, pz) }; }
      if (p.length === 2) {
        const id = p[1], g = q('SELECT * FROM games WHERE id=?').get(id); if (!parseId(id)) throw new HttpError(400, 'Invalid puzzle id'); if (!g) throw new HttpError(404, 'Game not found'); const pz = puzzle(id);
        if (m === 'GET') return { body: gameDto(g, pz) };
        if (m === 'PUT') {
          if (g.status === 'solved') throw new HttpError(409, 'This puzzle is already solved'); const b = await readBody(req), board = boardIn(b.board, pz), d = {};
          if (!Number.isInteger(b.seconds) || b.seconds < 0 || b.seconds > MAX_SECONDS) d.seconds = 'seconds must be a whole number from 0 to 604800'; else if (b.seconds < g.seconds) d.seconds = 'seconds cannot go backwards'; if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
          const solved = board === pz.solution; q('UPDATE games SET board=?, seconds=?, status=?, solved_at=CASE WHEN ? THEN datetime(\'now\') ELSE NULL END WHERE id=?').run(board, b.seconds, solved ? 'solved' : 'playing', solved ? 1 : 0, id); return { body: gameDto(q('SELECT * FROM games WHERE id=?').get(id), pz) };
        }
        if (m === 'DELETE') { q('DELETE FROM games WHERE id=?').run(id); return { status: 204 }; }
      }
    }
    if (p[0] === 'stats' && m === 'GET') {
      const out = {}; for (const d of Object.keys(CLUES)) { const s = q('SELECT seconds, hints FROM games WHERE difficulty=? AND status=\'solved\'').all(d), clean = s.filter((x) => x.hints === 0); out[d] = { solved: s.length, bestClean: clean.length ? Math.min(...clean.map((x) => x.seconds)) : null, bestAny: s.length ? Math.min(...s.map((x) => x.seconds)) : null, inProgress: q('SELECT COUNT(*) n FROM games WHERE difficulty=? AND status=\'playing\'').get(d).n }; } return { body: out };
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
      if (rel === 'sudoku.js') return send(200, await readFile(join(SRC, 'sudoku.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/gridlock.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Gridlock listening on :${port}`));
}
