import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { isDate, consumption, averageConsumption, costPerKm, serviceStatus } from './car.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const MAX_ODO = 3_000_000;

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE cars(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), plate TEXT NOT NULL DEFAULT '' CHECK(length(plate) <= 12));
    CREATE TABLE fills(id INTEGER PRIMARY KEY AUTOINCREMENT, car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE, day TEXT NOT NULL, odometer INTEGER NOT NULL, ml INTEGER NOT NULL CHECK(ml > 0), price INTEGER NOT NULL CHECK(price >= 0), full INTEGER NOT NULL CHECK(full IN (0,1)));
    CREATE TABLE tasks(id INTEGER PRIMARY KEY AUTOINCREMENT, car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), every_km INTEGER, every_months INTEGER, CHECK(every_km IS NOT NULL OR every_months IS NOT NULL));
    CREATE TABLE services(id INTEGER PRIMARY KEY AUTOINCREMENT, car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE, task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL, label TEXT NOT NULL, day TEXT NOT NULL, odometer INTEGER NOT NULL, cost INTEGER NOT NULL CHECK(cost >= 0), note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 200));
    CREATE INDEX idx_fills_car ON fills(car_id, odometer); CREATE INDEX idx_services_car ON services(car_id, day);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 10_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const money = (x) => { if (typeof x !== 'string') return null; const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(x.trim().replace(/^\$/, '').replace(/,/g, '')); return m ? Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0) : null; };
const litersToMl = (x) => { if (typeof x !== 'string') return null; const m = /^(\d{1,4})(?:\.(\d{1,3}))?$/.exec(x.trim()); if (!m) return null; const ml = Number(m[1]) * 1000 + Number((m[2] || '').padEnd(3, '0') || 0); return ml > 0 ? ml : null; };

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const todayOf = (sp) => { const utc = now().toISOString().slice(0, 10), c = sp?.get('today'); return c && isDate(c) && Math.abs(Date.parse(c + 'T00:00:00Z') - Date.parse(utc + 'T00:00:00Z')) <= 86400000 ? c : utc; };
  const car = (id) => { const c = q('SELECT * FROM cars WHERE id=?').get(id); if (!c) throw new HttpError(404, 'Car not found'); return c; };
  const allEntries = (carId) => [...q('SELECT id, day, odometer, \'fill\' kind FROM fills WHERE car_id=?').all(carId), ...q('SELECT id, day, odometer, \'service\' kind FROM services WHERE car_id=?').all(carId)];
  /** An odometer reading must fit between the readings on earlier and later days (same-day entries are unconstrained). */
  function checkOdometer(carId, day, odo) {
    const es = allEntries(carId), lo = Math.max(-1, ...es.filter((e) => e.day < day).map((e) => e.odometer)), hi = Math.min(Infinity, ...es.filter((e) => e.day > day).map((e) => e.odometer));
    if (odo < lo) throw new HttpError(422, 'Validation failed', { odometer: `Odometer can’t be below ${lo} km, the reading on an earlier date` }); if (odo > hi) throw new HttpError(422, 'Validation failed', { odometer: `Odometer can’t be above ${hi} km, the reading on a later date` });
  }
  function entryIn(b, carId, today) {
    const d = {}, day = b.day ?? today; if (!isDate(day) || day < '1990-01-01') d.day = 'Date must be a valid YYYY-MM-DD'; else if (day > today) d.day = 'You can’t record a future date';
    if (!Number.isInteger(b.odometer) || b.odometer < 0 || b.odometer > MAX_ODO) d.odometer = 'Odometer must be a whole number of km'; return { d, day };
  }
  function summary(c, today) {
    const fills = q('SELECT * FROM fills WHERE car_id=? ORDER BY odometer, day').all(c.id), services = q('SELECT * FROM services WHERE car_id=? ORDER BY day DESC, id DESC').all(c.id), tasks = q('SELECT * FROM tasks WHERE car_id=? ORDER BY name').all(c.id);
    const odometer = Math.max(0, ...allEntries(c.id).map((e) => e.odometer)), trips = consumption(fills.map((f) => ({ day: f.day, odometer: f.odometer, ml: f.ml, full: !!f.full }))), avg = averageConsumption(trips);
    const firstFull = fills.find((f) => f.full), measuredFuelCents = firstFull ? fills.filter((f) => f.odometer > firstFull.odometer || (f.odometer === firstFull.odometer && f.id !== firstFull.id && f.day > firstFull.day)).reduce((s, f) => s + f.price, 0) : 0;
    const lastFull = [...fills].reverse().find((f) => f.full); const km = avg?.km ?? 0;
    const fuelCents = lastFull && firstFull ? fills.filter((f) => f.odometer > firstFull.odometer && f.odometer <= lastFull.odometer).reduce((s, f) => s + f.price, 0) : 0;
    return {
      id: c.id, name: c.name, plate: c.plate, odometer, trips: trips.slice().reverse(), average: avg, fuelSpend: fills.reduce((s, f) => s + f.price, 0), costPerKm: costPerKm(fuelCents, km), serviceSpend: services.reduce((s, x) => s + x.cost, 0), measuredFuelCents,
      fills: [...fills].reverse().map((f) => ({ id: f.id, day: f.day, odometer: f.odometer, liters: f.ml / 1000, price: f.price, full: !!f.full })),
      services: services.map((s) => ({ id: s.id, taskId: s.task_id, label: s.label, day: s.day, odometer: s.odometer, cost: s.cost, note: s.note })),
      tasks: tasks.map((t) => { const last = q('SELECT odometer, day FROM services WHERE car_id=? AND task_id=? ORDER BY day DESC, odometer DESC LIMIT 1').get(c.id, t.id); return { id: t.id, name: t.name, everyKm: t.every_km, everyMonths: t.every_months, last: last ?? null, ...serviceStatus({ everyKm: t.every_km, everyMonths: t.every_months }, last, odometer, today) }; }),
    };
  }
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams, today = todayOf(sp);
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] !== 'cars') throw new HttpError(404, 'Not found');
    if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM cars ORDER BY name COLLATE NOCASE').all().map((c) => { const s = summary(c, today); return { id: c.id, name: c.name, plate: c.plate, odometer: s.odometer, average: s.average?.lPer100 ?? null, attention: s.tasks.filter((t) => t.status === 'overdue' || t.status === 'soon').length }; }) };
    if (p.length === 1 && m === 'POST') { const b = await readBody(req), d = {}, name = typeof b.name === 'string' ? b.name.trim() : '', plate = typeof (b.plate ?? '') === 'string' ? (b.plate ?? '').trim().toUpperCase() : null; if (!name || name.length > 60) d.name = 'Name is required (max 60 characters)'; if (plate === null || plate.length > 12) d.plate = 'Plate must be ≤ 12 characters'; if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); const r = q('INSERT INTO cars(name,plate) VALUES(?,?)').run(name, plate); return { status: 201, body: summary(car(Number(r.lastInsertRowid)), today) }; }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const c = car(id);
    if (p.length === 2 && m === 'GET') return { body: summary(c, today) }; if (p.length === 2 && m === 'DELETE') { q('DELETE FROM cars WHERE id=?').run(id); return { status: 204 }; }
    if (p[2] === 'fills' && m === 'POST') {
      const b = await readBody(req), { d, day } = entryIn(b, id, today), ml = litersToMl(b.liters), price = money(b.price); if (ml === null) d.liters = 'Liters must look like 41.250 (text)'; if (price === null) d.price = 'Total price must look like 62.40 (text)'; if (typeof b.full !== 'boolean') d.full = 'full must be true or false';
      if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); checkOdometer(id, day, b.odometer); q('INSERT INTO fills(car_id,day,odometer,ml,price,full) VALUES(?,?,?,?,?,?)').run(id, day, b.odometer, ml, price, b.full ? 1 : 0); return { status: 201, body: summary(c, today) };
    }
    if (p[2] === 'fills' && p[3] && m === 'DELETE') { const r = q('DELETE FROM fills WHERE id=? AND car_id=?').run(Number(p[3]), id); if (!r.changes) throw new HttpError(404, 'Fill-up not found'); return { body: summary(c, today) }; }
    if (p[2] === 'tasks' && m === 'POST') {
      const b = await readBody(req), d = {}, name = typeof b.name === 'string' ? b.name.trim() : '', ek = b.everyKm ?? null, em = b.everyMonths ?? null; if (!name || name.length > 60) d.name = 'Name is required (max 60 characters)';
      if (ek === null && em === null) d.everyKm = 'Set a distance interval, a time interval, or both'; if (ek !== null && (!Number.isInteger(ek) || ek < 100 || ek > 500000)) d.everyKm = 'Distance interval must be 100–500,000 km'; if (em !== null && (!Number.isInteger(em) || em < 1 || em > 240)) d.everyMonths = 'Time interval must be 1–240 months';
      if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); q('INSERT INTO tasks(car_id,name,every_km,every_months) VALUES(?,?,?,?)').run(id, name, ek, em); return { status: 201, body: summary(c, today) };
    }
    if (p[2] === 'tasks' && p[3] && m === 'DELETE') { const r = q('DELETE FROM tasks WHERE id=? AND car_id=?').run(Number(p[3]), id); if (!r.changes) throw new HttpError(404, 'Task not found'); return { body: summary(c, today) }; }
    if (p[2] === 'services' && m === 'POST') {
      const b = await readBody(req), { d, day } = entryIn(b, id, today), cost = b.cost === '' || b.cost == null ? 0 : money(b.cost); if (cost === null) d.cost = 'Cost must look like 120.00 (text)'; const note = typeof (b.note ?? '') === 'string' ? (b.note ?? '').trim() : null; if (note === null || note.length > 200) d.note = 'Note must be ≤ 200 characters';
      let task = null; if (b.taskId != null) { task = q('SELECT * FROM tasks WHERE id=? AND car_id=?').get(b.taskId, id); if (!task) d.taskId = 'Unknown task'; } const label = task ? task.name : (typeof b.label === 'string' ? b.label.trim() : ''); if (!label || label.length > 60) d.label = 'Choose a task or describe the work (max 60 characters)';
      if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); checkOdometer(id, day, b.odometer); q('INSERT INTO services(car_id,task_id,label,day,odometer,cost,note) VALUES(?,?,?,?,?,?,?)').run(id, task?.id ?? null, label, day, b.odometer, cost, note); return { status: 201, body: summary(c, today) };
    }
    if (p[2] === 'services' && p[3] && m === 'DELETE') { const r = q('DELETE FROM services WHERE id=? AND car_id=?').run(Number(p[3]), id); if (!r.changes) throw new HttpError(404, 'Service not found'); return { body: summary(c, today) }; }
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
      if (rel === 'car.js') return send(200, await readFile(join(SRC, 'car.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/gearlog.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Gearlog listening on :${port}`));
}
