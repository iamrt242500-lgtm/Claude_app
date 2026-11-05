import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { isValidZone, allZones, findOverlap, isDate, cityName, offsetMinutes, localParts } from './tz.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const offsetLabel = (min) => `UTC${min < 0 ? '−' : '+'}${Math.floor(Math.abs(min) / 60)}${Math.abs(min) % 60 ? ':' + String(Math.abs(min) % 60).padStart(2, '0') : ''}`;

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE teams(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 60), zones TEXT NOT NULL, start_hour INTEGER NOT NULL CHECK(start_hour BETWEEN 0 AND 23), end_hour INTEGER NOT NULL CHECK(end_hour BETWEEN 1 AND 24), CHECK(start_hour < end_hour));
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 20_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
function validateInput(b, { needDate = true } = {}) {
  const d = {}, zones = Array.isArray(b.zones) ? b.zones : [];
  if (zones.length < 2 || zones.length > 8) d.zones = 'Choose 2 to 8 time zones';
  else if (zones.some((z) => !isValidZone(z))) d.zones = `Unknown time zone: ${zones.find((z) => !isValidZone(z))}`;
  else if (new Set(zones).size !== zones.length) d.zones = 'Time zones must be different';
  const start = b.start ?? 9, end = b.end ?? 17;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || start >= end) d.hours = 'Working hours must be whole hours with start before end (0–24)';
  if (needDate && !isDate(b.date)) d.date = 'Date must be a valid YYYY-MM-DD';
  if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
  return { zones, start, end, date: b.date };
}

export function createApp({ dbPath = ':memory:', now = () => Date.now() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const teamDto = (t) => ({ id: t.id, name: t.name, zones: JSON.parse(t.zones), start: t.start_hour, end: t.end_hour });
  const team404 = (id) => { const t = q('SELECT * FROM teams WHERE id=?').get(id); if (!t) throw new HttpError(404, 'Team not found'); return t; };
  function compute(v) {
    const r = findOverlap(v.zones, v.date, { start: v.start, end: v.end }), t = now();
    return { date: v.date, start: r.start, zones: r.zones.map((z) => ({ zone: z.zone, city: cityName(z.zone), offset: z.offset, offsetLabel: offsetLabel(z.offset), segments: z.segments, nowLocal: (() => { const p = localParts(z.zone, t); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; })() })),
      windows: r.windows, best: r.best, workStart: v.start, workEnd: v.end };
  }
  const teamIn = (b) => {
    const name = typeof b.name === 'string' ? b.name.trim() : '', d = {};
    if (!name) d.name = 'Name is required'; else if (name.length > 60) d.name = 'Name must be ≤ 60 characters';
    let v = null; try { v = validateInput(b, { needDate: false }); } catch (e) { if (e instanceof HttpError) Object.assign(d, e.details); else throw e; }
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
    return { name, ...v };
  };

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'zones' && m === 'GET') {
      const term = (sp.get('q') || '').toLowerCase().replace(/[\s_]+/g, ' ').trim(), t = now();
      return { body: allZones().filter((z) => !term || z.toLowerCase().replaceAll('_', ' ').includes(term)).slice(0, 25).map((z) => ({ zone: z, city: cityName(z), region: z.includes('/') ? z.split('/')[0] : '', offsetLabel: offsetLabel(offsetMinutes(z, t)) })) };
    }
    if (p[0] === 'overlap' && m === 'POST') return { body: compute(validateInput(await readBody(req))) };
    if (p[0] !== 'teams') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') return { body: q('SELECT * FROM teams ORDER BY name COLLATE NOCASE').all().map(teamDto) };
      if (m === 'POST') {
        const v = teamIn(await readBody(req)); if (q('SELECT 1 FROM teams WHERE name=?').get(v.name)) throw new HttpError(422, 'Validation failed', { name: `"${v.name}" already exists` });
        const r = q('INSERT INTO teams(name,zones,start_hour,end_hour) VALUES(?,?,?,?)').run(v.name, JSON.stringify(v.zones), v.start, v.end); return { status: 201, body: teamDto(team404(Number(r.lastInsertRowid))) };
      }
      throw new HttpError(405, 'Method not allowed');
    }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); team404(id);
    if (p.length === 2) {
      if (m === 'GET') return { body: teamDto(team404(id)) };
      if (m === 'PUT') { const v = teamIn(await readBody(req)); const dup = q('SELECT id FROM teams WHERE name=?').get(v.name); if (dup && dup.id !== id) throw new HttpError(422, 'Validation failed', { name: `"${v.name}" already exists` }); q('UPDATE teams SET name=?, zones=?, start_hour=?, end_hour=? WHERE id=?').run(v.name, JSON.stringify(v.zones), v.start, v.end, id); return { body: teamDto(team404(id)) }; }
      if (m === 'DELETE') { q('DELETE FROM teams WHERE id=?').run(id); return { status: 204 }; }
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/overlap.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Overlap listening on :${port}`));
}
