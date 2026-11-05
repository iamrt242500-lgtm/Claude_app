import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { PASSAGES } from './passages.js';
import { validateResult, weakKeys, dayStreak } from './typing.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE results(id INTEGER PRIMARY KEY AUTOINCREMENT, passage_id TEXT NOT NULL, level TEXT NOT NULL, day TEXT NOT NULL, duration_ms INTEGER NOT NULL, typed INTEGER NOT NULL, correct INTEGER NOT NULL, keystrokes INTEGER NOT NULL, wrong INTEGER NOT NULL,
      wpm REAL NOT NULL, raw_wpm REAL NOT NULL, accuracy REAL NOT NULL, mistakes TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE INDEX idx_results_day ON results(day); PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 50_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const isDate = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const dto = (r) => ({ id: r.id, passageId: r.passage_id, level: r.level, day: r.day, durationMs: r.duration_ms, typedChars: r.typed, correctChars: r.correct, wpm: r.wpm, rawWpm: r.raw_wpm, accuracy: r.accuracy, mistakes: JSON.parse(r.mistakes), createdAt: r.created_at });
  const today = (sp) => { const c = sp?.get('today'), utc = now().toISOString().slice(0, 10); return c && isDate(c) && Math.abs(Date.parse(c + 'T00:00:00Z') - Date.parse(utc + 'T00:00:00Z')) <= 86400000 ? c : utc; };

  function stats(sp) {
    const all = q('SELECT * FROM results ORDER BY id DESC').all().map(dto), T = today(sp);
    const best = {}; for (const r of all) if (!best[r.level] || r.wpm > best[r.level].wpm) best[r.level] = { wpm: r.wpm, accuracy: r.accuracy, passageId: r.passageId, day: r.day };
    const last10 = all.slice(0, 10);
    return { total: all.length, best, averageWpm: last10.length ? Math.round((last10.reduce((s, r) => s + r.wpm, 0) / last10.length) * 10) / 10 : null, averageAccuracy: last10.length ? Math.round((last10.reduce((s, r) => s + r.accuracy, 0) / last10.length) * 10) / 10 : null,
      streak: dayStreak([...new Set(all.map((r) => r.day))], T), weakKeys: weakKeys(all.slice(0, 50)), trend: all.slice(0, 20).reverse().map((r) => ({ id: r.id, wpm: r.wpm, accuracy: r.accuracy })) };
  }

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'passages' && m === 'GET') return { body: PASSAGES.filter((x) => !sp.get('level') || x.level === sp.get('level')) };
    if (p[0] === 'stats' && m === 'GET') return { body: stats(sp) };
    if (p[0] === 'results') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM results ORDER BY id DESC LIMIT 50').all().map(dto) };
      if (p.length === 1 && m === 'POST') {
        const b = await readBody(req), passage = PASSAGES.find((x) => x.id === b.passageId); if (!passage) throw new HttpError(422, 'Validation failed', { passageId: 'Unknown passage' });
        const r = validateResult(b, passage); if (r.errors) throw new HttpError(422, 'Validation failed', r.errors); const v = r.value;
        const res = q('INSERT INTO results(passage_id,level,day,duration_ms,typed,correct,keystrokes,wrong,wpm,raw_wpm,accuracy,mistakes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(passage.id, passage.level, today(sp), v.durationMs, v.typedChars, v.correctChars, v.keystrokes, v.wrongKeystrokes, v.wpm, v.rawWpm, v.accuracy, JSON.stringify(v.mistakes));
        const id = Number(res.lastInsertRowid), row = dto(q('SELECT * FROM results WHERE id=?').get(id)), best = q('SELECT MAX(wpm) m FROM results WHERE level=? AND id<>?').get(passage.level, id).m;
        return { status: 201, body: { ...row, personalBest: best == null || row.wpm > best, previousBest: best } };
      }
      if (p.length === 2 && m === 'DELETE') { const id = Number(p[1]); if (!Number.isInteger(id) || !q('SELECT 1 FROM results WHERE id=?').get(id)) throw new HttpError(404, 'Result not found'); q('DELETE FROM results WHERE id=?').run(id); return { status: 204 }; }
      if (p.length === 1 && m === 'DELETE') { q('DELETE FROM results').run(); return { status: 204 }; }
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
      if (rel === 'typing.js') return send(200, await readFile(join(SRC, 'typing.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/typo.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Typo listening on :${port}`));
}
