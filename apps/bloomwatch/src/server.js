import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { isDate, season, interval, dueStatus, adherence } from './plants.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE plants(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), species TEXT NOT NULL DEFAULT '' CHECK(length(species) <= 60), location TEXT NOT NULL DEFAULT '' CHECK(length(location) <= 40), every_days INTEGER NOT NULL CHECK(every_days BETWEEN 1 AND 90), seasonal INTEGER NOT NULL DEFAULT 1, added TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE waterings(plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE, day TEXT NOT NULL, note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 100), PRIMARY KEY(plant_id, day)) WITHOUT ROWID;
    CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id = 1), south INTEGER NOT NULL DEFAULT 0); INSERT INTO settings VALUES(1, 0);
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
  const south = () => !!q('SELECT south FROM settings').get().south;
  const plant = (id) => { const p = q('SELECT * FROM plants WHERE id=?').get(id); if (!p) throw new HttpError(404, 'Plant not found'); return p; };
  function dto(p, today) {
    const days = q('SELECT day FROM waterings WHERE plant_id=? ORDER BY day').all(p.id).map((r) => r.day), last = days.at(-1) ?? null, sz = south();
    const model = { added: p.added, lastWatered: last, everyDays: p.every_days, seasonal: !!p.seasonal }, st = p.archived ? null : dueStatus(model, today, sz);
    return { id: p.id, name: p.name, species: p.species, location: p.location, everyDays: p.every_days, seasonal: !!p.seasonal, archived: !!p.archived, added: p.added, lastWatered: last, waterings: days.length, season: season(today, sz), currentInterval: interval(model, today, sz), nextWatering: st?.due ?? null, daysLeft: st?.daysLeft ?? null, status: st?.status ?? 'archived', adherence: adherence(days.slice(-6), p.every_days) };
  }
  function plantIn(b, prev, today) {
    const d = {}, name = (b.name ?? prev?.name ?? '').toString().trim(), species = (b.species ?? prev?.species ?? '').toString().trim(), location = (b.location ?? prev?.location ?? '').toString().trim(), every = b.everyDays ?? prev?.every_days, added = b.added ?? prev?.added ?? today, seasonal = b.seasonal ?? (prev ? !!prev.seasonal : true);
    if (!name || name.length > 60) d.name = 'Name is required (max 60 characters)'; if (species.length > 60) d.species = 'Species must be ≤ 60 characters'; if (location.length > 40) d.location = 'Location must be ≤ 40 characters'; if (!Number.isInteger(every) || every < 1 || every > 90) d.everyDays = 'Watering interval must be 1–90 days'; if (!isDate(added)) d.added = 'Date must be a valid YYYY-MM-DD'; if (typeof seasonal !== 'boolean') d.seasonal = 'seasonal must be true or false';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { name, species, location, every, added, seasonal };
  }
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams, today = todayOf(sp);
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'settings') { if (m === 'GET') return { body: { southern: south() } }; if (m === 'PUT') { const b = await readBody(req); if (typeof b.southern !== 'boolean') throw new HttpError(422, 'Validation failed', { southern: 'southern must be true or false' }); q('UPDATE settings SET south=? WHERE id=1').run(b.southern ? 1 : 0); return { body: { southern: south() } }; } }
    if (p[0] === 'today' && m === 'GET') { const all = q('SELECT * FROM plants WHERE archived=0').all().map((x) => dto(x, today)), by = (s) => all.filter((x) => x.status === s).sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name)); return { body: { today, season: season(today, south()), overdue: by('overdue'), today_: by('today'), soon: by('soon'), ok: by('ok'), total: all.length } }; }
    if (p[0] === 'plants') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM plants ORDER BY archived, name COLLATE NOCASE').all().map((x) => dto(x, today)) };
      if (p.length === 1 && m === 'POST') { const v = plantIn(await readBody(req), null, today); const r = q('INSERT INTO plants(name,species,location,every_days,seasonal,added) VALUES(?,?,?,?,?,?)').run(v.name, v.species, v.location, v.every, v.seasonal ? 1 : 0, v.added); return { status: 201, body: dto(plant(Number(r.lastInsertRowid)), today) }; }
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const pl = plant(id);
      if (p.length === 2 && m === 'GET') return { body: { ...dto(pl, today), history: q('SELECT day, note FROM waterings WHERE plant_id=? ORDER BY day DESC LIMIT 30').all(id) } };
      if (p.length === 2 && m === 'PATCH') { const b = await readBody(req); if (b.archived !== undefined && typeof b.archived !== 'boolean') throw new HttpError(422, 'Validation failed', { archived: 'archived must be true or false' }); const v = plantIn(b, pl, today); q('UPDATE plants SET name=?, species=?, location=?, every_days=?, seasonal=?, added=?, archived=? WHERE id=?').run(v.name, v.species, v.location, v.every, v.seasonal ? 1 : 0, v.added, b.archived === undefined ? pl.archived : b.archived ? 1 : 0, id); return { body: dto(plant(id), today) }; }
      if (p.length === 2 && m === 'DELETE') { q('DELETE FROM plants WHERE id=?').run(id); return { status: 204 }; }
      if (p[2] === 'water' && m === 'POST') {
        const b = await readBody(req), d = {}, day = b.day ?? today, note = typeof (b.note ?? '') === 'string' ? (b.note ?? '').trim() : null; if (!isDate(day)) d.day = 'Date must be a valid YYYY-MM-DD'; else if (day > today) d.day = 'You can’t water in the future'; else if (day < pl.added) d.day = `This plant was added on ${pl.added}`; if (note === null || note.length > 100) d.note = 'Note must be ≤ 100 characters';
        if (pl.archived) throw new HttpError(409, 'This plant is archived'); if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); q('INSERT INTO waterings(plant_id,day,note) VALUES(?,?,?) ON CONFLICT(plant_id,day) DO UPDATE SET note=excluded.note').run(id, day, note); return { status: 201, body: dto(pl, today) };
      }
      if (p[2] === 'water' && p[3] && m === 'DELETE') { if (!isDate(p[3])) throw new HttpError(400, 'Invalid date'); const r = q('DELETE FROM waterings WHERE plant_id=? AND day=?').run(id, p[3]); if (!r.changes) throw new HttpError(404, 'No watering on that day'); return { body: dto(pl, today) }; }
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/bloomwatch.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Bloomwatch listening on :${port}`));
}
