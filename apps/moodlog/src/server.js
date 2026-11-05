import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { mean, pearson, strength, movingAverage, tagEffects, byWeekday } from './stats.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE entries(day TEXT PRIMARY KEY, mood INTEGER NOT NULL CHECK(mood BETWEEN 1 AND 5), energy INTEGER NOT NULL CHECK(energy BETWEEN 1 AND 5), sleep REAL CHECK(sleep IS NULL OR (sleep >= 0 AND sleep <= 24)), note TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT(datetime('now'))) WITHOUT ROWID;
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 10_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const int15 = (v) => Number.isInteger(v) && v >= 1 && v <= 5;
export function normTags(input) {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [], out = [];
  for (const t of raw) { if (typeof t !== 'string') return null; const s = t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-'); if (!s) continue; if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(s)) return null; if (!out.includes(s)) out.push(s); }
  return out.length > 8 ? null : out;
}

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const todayOf = (sp) => { const utc = now().toISOString().slice(0, 10), c = sp.get('today'); return c && isDate(c) && Math.abs(Date.parse(c + 'T00:00:00Z') - Date.parse(utc + 'T00:00:00Z')) <= 86400000 ? c : utc; };
  const dto = (r) => ({ day: r.day, mood: r.mood, energy: r.energy, sleep: r.sleep, note: r.note, tags: JSON.parse(r.tags) });
  function entryIn(day, b, today) {
    const d = {}; if (!isDate(day)) throw new HttpError(400, 'Invalid date'); if (day > today) d.day = 'You can’t log a future day'; if (day < '2000-01-01') d.day = 'Date is too far in the past';
    if (!int15(b.mood)) d.mood = 'Mood must be a whole number from 1 to 5'; if (!int15(b.energy)) d.energy = 'Energy must be a whole number from 1 to 5';
    const sleep = b.sleep === '' || b.sleep == null ? null : Number(b.sleep); if (sleep !== null && !(Number.isFinite(sleep) && sleep >= 0 && sleep <= 24)) d.sleep = 'Sleep must be between 0 and 24 hours';
    const note = typeof b.note === 'string' ? b.note.trim() : ''; if (note.length > 500) d.note = 'Note must be ≤ 500 characters';
    const tags = normTags(b.tags ?? []); if (tags === null) d.tags = 'Up to 8 tags; letters, digits and dashes only, ≤ 20 characters each';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { day, mood: b.mood, energy: b.energy, sleep, note, tags };
  }
  function insights(days, today) {
    const from = addDays(today, -(days - 1)), rows = q('SELECT * FROM entries WHERE day BETWEEN ? AND ? ORDER BY day').all(from, today).map(dto);
    const out = { from, to: today, days, logged: rows.length, avgMood: mean(rows.map((r) => r.mood)), avgEnergy: mean(rows.map((r) => r.energy)), avgSleep: mean(rows.filter((r) => r.sleep != null).map((r) => r.sleep)) };
    const series = []; for (let i = 0; i < days; i++) { const day = addDays(from, i), r = rows.find((x) => x.day === day); series.push({ day, mood: r?.mood ?? null, energy: r?.energy ?? null }); }
    const ma = movingAverage(rows.map((r) => r.mood), 7); out.series = series; out.movingAverage = rows.map((r, i) => ({ day: r.day, avg: ma[i] == null ? null : Math.round(ma[i] * 100) / 100 }));
    const withSleep = rows.filter((r) => r.sleep != null), r1 = pearson(withSleep.map((r) => r.sleep), withSleep.map((r) => r.mood)), r2 = pearson(rows.map((r) => r.energy), rows.map((r) => r.mood));
    out.correlations = { sleepMood: { r: r1 == null ? null : Math.round(r1 * 100) / 100, n: withSleep.length, label: strength(r1) }, energyMood: { r: r2 == null ? null : Math.round(r2 * 100) / 100, n: rows.length, label: strength(r2) } };
    out.tagEffects = tagEffects(rows).map((t) => ({ ...t, withTag: Math.round(t.withTag * 100) / 100, without: Math.round(t.without * 100) / 100, diff: Math.round(t.diff * 100) / 100 }));
    out.weekday = byWeekday(rows).map((w) => ({ n: w.n, avg: w.avg == null ? null : Math.round(w.avg * 100) / 100 }));
    const all = new Set(q('SELECT day FROM entries').all().map((r) => r.day)); let streak = 0, d = all.has(today) ? today : addDays(today, -1); while (all.has(d)) { streak++; d = addDays(d, -1); } out.streak = streak;
    return out;
  }
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams, today = todayOf(sp);
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'entries') {
      if (p.length === 1 && m === 'GET') {
        const from = sp.get('from') ?? '0000-01-01', to = sp.get('to') ?? '9999-12-31'; if ((sp.has('from') && !isDate(from)) || (sp.has('to') && !isDate(to))) throw new HttpError(400, 'Invalid date range');
        return { body: q('SELECT * FROM entries WHERE day BETWEEN ? AND ? ORDER BY day DESC LIMIT 1000').all(from, to).map(dto) };
      }
      if (p.length === 2) {
        const day = p[1];
        if (m === 'GET') { if (!isDate(day)) throw new HttpError(400, 'Invalid date'); const r = q('SELECT * FROM entries WHERE day=?').get(day); if (!r) throw new HttpError(404, 'No entry for that day'); return { body: dto(r) }; }
        if (m === 'PUT') { const v = entryIn(day, await readBody(req), today), existed = !!q('SELECT 1 FROM entries WHERE day=?').get(day); q('INSERT INTO entries(day,mood,energy,sleep,note,tags) VALUES(?,?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET mood=excluded.mood, energy=excluded.energy, sleep=excluded.sleep, note=excluded.note, tags=excluded.tags, updated_at=datetime(\'now\')').run(v.day, v.mood, v.energy, v.sleep, v.note, JSON.stringify(v.tags)); return { status: existed ? 200 : 201, body: dto(q('SELECT * FROM entries WHERE day=?').get(day)) }; }
        if (m === 'DELETE') { if (!isDate(day)) throw new HttpError(400, 'Invalid date'); const r = q('DELETE FROM entries WHERE day=?').run(day); if (!r.changes) throw new HttpError(404, 'No entry for that day'); return { status: 204 }; }
      }
    }
    if (p[0] === 'insights' && m === 'GET') { const days = sp.has('days') ? Number(sp.get('days')) : 30; if (!Number.isInteger(days) || days < 7 || days > 365) throw new HttpError(422, 'Validation failed', { days: 'days must be a whole number from 7 to 365' }); return { body: insights(days, today) }; }
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/moodlog.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Moodlog listening on :${port}`));
}
