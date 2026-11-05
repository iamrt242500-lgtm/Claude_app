import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { roundRobin, bracket, standings } from './tournament.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE tournaments(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), format TEXT NOT NULL CHECK(format IN ('roundrobin','knockout')), players TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE matches(id INTEGER PRIMARY KEY AUTOINCREMENT, tid INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, round INTEGER NOT NULL, idx INTEGER NOT NULL, a INTEGER, b INTEGER, sa INTEGER, sb INTEGER, winner INTEGER, bye INTEGER NOT NULL DEFAULT 0, UNIQUE(tid, round, idx));
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 20_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  let depth = 0; const tx = (fn) => { if (depth) return fn(); db.exec('BEGIN'); depth++; try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { depth--; } };
  const tour = (id) => { const t = q('SELECT * FROM tournaments WHERE id=?').get(id); if (!t) throw new HttpError(404, 'Tournament not found'); return t; };
  const matchesOf = (id) => q('SELECT * FROM matches WHERE tid=? ORDER BY round, idx').all(id);
  const mdto = (m) => ({ id: m.id, round: m.round, idx: m.idx, a: m.a, b: m.b, sa: m.sa, sb: m.sb, winner: m.winner, bye: !!m.bye });
  function dto(t) {
    const players = JSON.parse(t.players), ms = matchesOf(t.id), out = { id: t.id, name: t.name, format: t.format, players, matches: ms.map(mdto) };
    if (t.format === 'roundrobin') { const played = ms.filter((m) => m.sa !== null); out.standings = standings(players.length, played.map((m) => ({ a: m.a, b: m.b, sa: m.sa, sb: m.sb }))); out.progress = { played: played.length, total: ms.length }; out.champion = played.length === ms.length ? out.standings[0].i : null; }
    else { const rounds = Math.max(...ms.map((m) => m.round)) + 1, final = ms.find((m) => m.round === rounds - 1); out.rounds = rounds; out.champion = final?.winner ?? null; out.progress = { played: ms.filter((m) => m.winner !== null && !m.bye).length, total: ms.filter((m) => !m.bye).length }; }
    return out;
  }
  /** Put the winner of (round, idx) into the next round's slot (or clear it when winner is null). */
  function propagate(tid, round, idx, winner) {
    const next = q('SELECT * FROM matches WHERE tid=? AND round=? AND idx=?').get(tid, round + 1, idx >> 1); if (!next) return;
    q(`UPDATE matches SET ${idx % 2 === 0 ? 'a' : 'b'}=? WHERE id=?`).run(winner, next.id);
  }
  function create(b) {
    const d = {}, name = typeof b.name === 'string' ? b.name.trim() : '', raw = Array.isArray(b.players) ? b.players : typeof b.players === 'string' ? b.players.split('\n') : [];
    const players = raw.map((p) => (typeof p === 'string' ? p.trim().replace(/\s+/g, ' ') : null)).filter((p) => p !== ''); 
    if (!name || name.length > 60) d.name = 'Name is required (max 60 characters)'; if (!['roundrobin', 'knockout'].includes(b.format)) d.format = 'Format must be roundrobin or knockout';
    if (players.some((p) => p === null || p.length > 30)) d.players = 'Each player name must be text of at most 30 characters'; else if (players.length < 2 || players.length > 32) d.players = 'Enter 2 to 32 players'; else if (new Set(players.map((p) => p.toLowerCase())).size !== players.length) d.players = 'Player names must be unique';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
    return tx(() => {
      const id = Number(q('INSERT INTO tournaments(name,format,players) VALUES(?,?,?)').run(name, b.format, JSON.stringify(players)).lastInsertRowid), ins = q('INSERT INTO matches(tid,round,idx,a,b,winner,bye) VALUES(?,?,?,?,?,?,?)');
      if (b.format === 'roundrobin') roundRobin(players.length).forEach((round, r) => round.forEach(([a, c], i) => ins.run(id, r, i, a, c, null, 0)));
      else { const br = bracket(players.length); br.rounds.forEach((round, r) => round.forEach((m, i) => { const [sa, sb] = m.slot.map((s) => (s === null ? null : s - 1)); ins.run(id, r, i, r === 0 ? sa : null, r === 0 ? sb : null, null, 0); }));
        for (const m of q('SELECT * FROM matches WHERE tid=? AND round=0').all(id)) if ((m.a === null) !== (m.b === null)) { const w = m.a ?? m.b; q('UPDATE matches SET winner=?, bye=1 WHERE id=?').run(w, m.id); propagate(id, 0, m.idx, w); } }
      return id;
    });
  }
  function setResult(tid, mid, b) {
    const t = tour(tid), m = q('SELECT * FROM matches WHERE id=? AND tid=?').get(mid, tid); if (!m) throw new HttpError(404, 'Match not found'); const d = {};
    if (m.bye) throw new HttpError(409, 'A bye has no result'); if (m.a === null || m.b === null) throw new HttpError(409, 'This match is waiting for earlier results');
    const ok = (x) => Number.isInteger(x) && x >= 0 && x <= 999; if (!ok(b.sa)) d.sa = 'Score must be a whole number from 0 to 999'; if (!ok(b.sb)) d.sb = 'Score must be a whole number from 0 to 999'; if (!d.sa && !d.sb && t.format === 'knockout' && b.sa === b.sb) d.sb = 'Knockout matches can’t end in a draw';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
    return tx(() => {
      const winner = t.format === 'knockout' ? (b.sa > b.sb ? m.a : m.b) : null;
      if (t.format === 'knockout' && m.winner !== null && m.winner !== winner) { const next = q('SELECT * FROM matches WHERE tid=? AND round=? AND idx=?').get(tid, m.round + 1, m.idx >> 1); if (next && next.winner !== null) throw new HttpError(409, 'The winner already advanced and played — clear the later result first'); }
      q('UPDATE matches SET sa=?, sb=?, winner=? WHERE id=?').run(b.sa, b.sb, winner, mid); if (t.format === 'knockout') propagate(tid, m.round, m.idx, winner);
    });
  }
  function clearResult(tid, mid) {
    const t = tour(tid), m = q('SELECT * FROM matches WHERE id=? AND tid=?').get(mid, tid); if (!m) throw new HttpError(404, 'Match not found'); if (m.bye) throw new HttpError(409, 'A bye has no result');
    tx(() => { if (t.format === 'knockout') { const next = q('SELECT * FROM matches WHERE tid=? AND round=? AND idx=?').get(tid, m.round + 1, m.idx >> 1); if (next && next.winner !== null) throw new HttpError(409, 'The winner already played the next round — clear that result first'); propagate(tid, m.round, m.idx, null); } q('UPDATE matches SET sa=NULL, sb=NULL, winner=NULL WHERE id=?').run(mid); });
  }
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'tournaments') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM tournaments ORDER BY id DESC').all().map((t) => { const d = dto(t); return { id: d.id, name: d.name, format: d.format, players: d.players.length, progress: d.progress, champion: d.champion === null ? null : d.players[d.champion] }; }) };
      if (p.length === 1 && m === 'POST') return { status: 201, body: dto(tour(create(await readBody(req)))) };
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const t = tour(id);
      if (p.length === 2 && m === 'GET') return { body: dto(t) }; if (p.length === 2 && m === 'DELETE') { q('DELETE FROM tournaments WHERE id=?').run(id); return { status: 204 }; }
      if (p[2] === 'matches' && p[3]) { const mid = Number(p[3]); if (!Number.isInteger(mid)) throw new HttpError(400, 'Invalid id'); if (p[4] === 'result' && m === 'PUT') { setResult(id, mid, await readBody(req)); return { body: dto(tour(id)) }; } if (p[4] === 'result' && m === 'DELETE') { clearResult(id, mid); return { body: dto(tour(id)) }; } }
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
      if (rel === 'tournament.js') return send(200, await readFile(join(SRC, 'tournament.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/tallyho.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Tallyho listening on :${port}`));
}
