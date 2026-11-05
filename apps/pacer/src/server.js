import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { parseTime, parseDistance, formatTime, solve, splits, riegel, paceSec, speedKmh } from './pace.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const STANDARD = [['5K', 5000], ['10K', 10000], ['Half marathon', 21097.5], ['Marathon', 42195]];

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE goals(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), distance_m REAL NOT NULL CHECK(distance_m > 0), time_s REAL NOT NULL CHECK(time_s > 0), race_date TEXT, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 20_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const blank = (v) => v == null || (typeof v === 'string' && !v.trim());
const r1 = (n) => Math.round(n * 10) / 10;
const view = (d, t, unit) => ({ distance: Math.round(d * 100) / 100, time: Math.round(t * 100) / 100, timeText: formatTime(t), pace: Math.round(paceSec(d, t, unit) * 100) / 100, paceText: formatTime(paceSec(d, t, unit)), speedKmh: r1(speedKmh(d, t) * 100) / 100 });

export function calc(b) {
  const unit = b.unit === 'mi' ? 'mi' : 'km', d = {}; const dist = blank(b.distance) ? null : parseDistance(b.distance), time = blank(b.time) ? null : parseTime(b.time), pace = blank(b.pace) ? null : parseTime(b.pace);
  if (!blank(b.distance) && dist == null) d.distance = 'Distance not understood (try 10k, 6.2 mi, half, 800m)'; if (!blank(b.time) && time == null) d.time = 'Time not understood (try 45:30, 1:45:30 or 1h30m)'; if (!blank(b.pace) && pace == null) d.pace = 'Pace not understood (try 5:30)';
  const given = [dist, time, pace].filter((x) => x != null).length; if (!Object.keys(d).length && given !== 2) d.form = given < 2 ? 'Fill in any two of distance, time and pace' : 'Leave one of distance, time and pace empty — it is the one to calculate';
  const neg = b.negative == null || b.negative === '' ? 0 : Number(b.negative); if (!Number.isFinite(neg) || neg < 0 || neg > 10) d.negative = 'Negative split must be between 0 and 10 %';
  if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
  const s = solve({ distance: dist, time, pace }, unit); if (s.distance > 1e6 || s.time > 1e6 || s.distance < 1) throw new HttpError(422, 'Validation failed', { form: 'Result is outside a sensible range (1 m – 1000 km, under 11 days)' });
  const sp = splits(s.distance, s.time, unit, neg);
  return { unit, ...view(s.distance, s.time, unit), splits: sp.splits.map((x) => ({ n: x.n, dist: Math.round(x.dist), split: formatTime(x.split), pace: formatTime(x.pace), cumulative: formatTime(x.cumulative) })),
    predictions: STANDARD.map(([name, m]) => { const t = riegel(s.time, s.distance, m); return { name, distance: m, time: formatTime(t), pace: formatTime(paceSec(m, t, unit)) }; }) };
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const dto = (g) => ({ id: g.id, name: g.name, raceDate: g.race_date, ...view(g.distance_m, g.time_s, 'km'), paceMi: formatTime(paceSec(g.distance_m, g.time_s, 'mi')) });
  const get = (id) => { const g = q('SELECT * FROM goals WHERE id=?').get(id); if (!g) throw new HttpError(404, 'Goal not found'); return g; };
  const goalIn = (b) => {
    const d = {}, name = typeof b.name === 'string' ? b.name.trim() : '', dist = parseDistance(b.distance), time = parseTime(b.time);
    if (!name) d.name = 'Name is required'; else if (name.length > 80) d.name = 'Name must be ≤ 80 characters'; if (dist == null) d.distance = 'Distance not understood'; if (time == null) d.time = 'Time not understood';
    if (!blank(b.raceDate) && !isDate(b.raceDate)) d.raceDate = 'Race date must be a valid YYYY-MM-DD'; if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
    return { name, dist, time, raceDate: blank(b.raceDate) ? null : b.raceDate };
  };
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'calc' && m === 'POST') return { body: calc(await readBody(req)) };
    if (p[0] === 'goals') {
      if (p.length === 1) {
        if (m === 'GET') return { body: q('SELECT * FROM goals ORDER BY race_date IS NULL, race_date, id').all().map(dto) };
        if (m === 'POST') { const v = goalIn(await readBody(req)); const r = q('INSERT INTO goals(name,distance_m,time_s,race_date) VALUES(?,?,?,?)').run(v.name, v.dist, v.time, v.raceDate); return { status: 201, body: dto(get(Number(r.lastInsertRowid))) }; }
      } else {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); get(id);
        if (m === 'PUT') { const v = goalIn(await readBody(req)); q('UPDATE goals SET name=?, distance_m=?, time_s=?, race_date=? WHERE id=?').run(v.name, v.dist, v.time, v.raceDate, id); return { body: dto(get(id)) }; }
        if (m === 'DELETE') { q('DELETE FROM goals WHERE id=?').run(id); return { status: 204 }; }
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
      if (rel === 'pace.js') return send(200, await readFile(join(SRC, 'pace.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/pacer.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Pacer listening on :${port}`));
}
