import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { isDate, addDays, UNITS, nextRenewal, occurrencesBetween, monthlyCost, yearlyCost, daysUntil, parseMoney } from './subs.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const CATEGORIES = ['entertainment', 'software', 'utilities', 'health', 'news', 'shopping', 'other'];

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE subs(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), price INTEGER NOT NULL CHECK(price >= 0), unit TEXT NOT NULL CHECK(unit IN ('week','month','year')), every INTEGER NOT NULL CHECK(every BETWEEN 1 AND 52), start TEXT NOT NULL, category TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 200), cancelled_day TEXT);
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
  const sub = (id) => { const s = q('SELECT * FROM subs WHERE id=?').get(id); if (!s) throw new HttpError(404, 'Subscription not found'); return s; };
  function dto(s, today) {
    const active = !s.cancelled_day || s.cancelled_day >= today, next = active ? nextRenewal(s.start, s.unit, s.every, today) : null, renew = next && (!s.cancelled_day || next <= s.cancelled_day) ? next : null;
    return { id: s.id, name: s.name, price: s.price, unit: s.unit, every: s.every, start: s.start, category: s.category, notes: s.notes, cancelledDay: s.cancelled_day, active: !s.cancelled_day, nextRenewal: s.cancelled_day ? null : renew, daysUntil: s.cancelled_day ? null : renew ? daysUntil(renew, today) : null, monthly: monthlyCost(s.price, s.unit, s.every), yearly: yearlyCost(s.price, s.unit, s.every) };
  }
  function subIn(b, prev) {
    const d = {}, name = (b.name ?? prev?.name ?? '').toString().trim(), unit = b.unit ?? prev?.unit, every = b.every ?? prev?.every, start = b.start ?? prev?.start, category = b.category ?? prev?.category ?? 'other', notes = (b.notes ?? prev?.notes ?? '').toString().trim();
    const price = b.price === undefined ? prev?.price : parseMoney(b.price);
    if (!name || name.length > 60) d.name = 'Name is required (max 60 characters)'; if (price === null || price === undefined) d.price = 'Price must look like 9.99 (text)'; if (!UNITS.includes(unit)) d.unit = 'Billing unit must be week, month or year'; if (!Number.isInteger(every) || every < 1 || every > 52) d.every = 'Repeat every must be 1–52';
    if (!isDate(start) || start < '2000-01-01') d.start = 'First payment date must be a valid YYYY-MM-DD'; if (!CATEGORIES.includes(category)) d.category = `Category must be one of ${CATEGORIES.join(', ')}`; if (notes.length > 200) d.notes = 'Notes must be ≤ 200 characters';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { name, price, unit, every, start, category, notes };
  }
  function overview(today, horizon) {
    const all = q('SELECT * FROM subs ORDER BY name COLLATE NOCASE').all().map((s) => dto(s, today)), live = all.filter((s) => s.active), end = addDays(today, horizon), upcoming = [];
    for (const s of live) for (const date of occurrencesBetween(s.start, s.unit, s.every, today, end)) upcoming.push({ id: s.id, name: s.name, date, amount: s.price, daysUntil: daysUntil(date, today) });
    upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    const byCat = {}; for (const s of live) byCat[s.category] = (byCat[s.category] || 0) + s.monthly;
    const cancelled = all.filter((s) => !s.active);
    return { today, horizon, count: live.length, monthly: live.reduce((a, s) => a + s.monthly, 0), yearly: live.reduce((a, s) => a + s.yearly, 0), byCategory: Object.entries(byCat).map(([category, monthly]) => ({ category, monthly })).sort((a, b) => b.monthly - a.monthly || a.category.localeCompare(b.category)), upcoming, upcomingTotal: upcoming.reduce((a, u) => a + u.amount, 0), cancelledCount: cancelled.length, savedPerMonth: cancelled.reduce((a, s) => a + s.monthly, 0), savedPerYear: cancelled.reduce((a, s) => a + s.yearly, 0) };
  }
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams, today = todayOf(sp);
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'categories') return { body: CATEGORIES };
    if (p[0] === 'overview' && m === 'GET') { const h = sp.has('days') ? Number(sp.get('days')) : 30; if (!Number.isInteger(h) || h < 1 || h > 366) throw new HttpError(422, 'Validation failed', { days: 'days must be a whole number from 1 to 366' }); return { body: overview(today, h) }; }
    if (p[0] === 'subs') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM subs').all().map((s) => dto(s, today)).sort((a, b) => (a.nextRenewal ?? '9999').localeCompare(b.nextRenewal ?? '9999') || a.name.localeCompare(b.name)) };
      if (p.length === 1 && m === 'POST') { const v = subIn(await readBody(req)); const r = q('INSERT INTO subs(name,price,unit,every,start,category,notes) VALUES(?,?,?,?,?,?,?)').run(v.name, v.price, v.unit, v.every, v.start, v.category, v.notes); return { status: 201, body: dto(sub(Number(r.lastInsertRowid)), today) }; }
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const s = sub(id);
      if (p.length === 2 && m === 'GET') return { body: { ...dto(s, today), upcoming: s.cancelled_day ? [] : occurrencesBetween(s.start, s.unit, s.every, today, addDays(today, 365)).slice(0, 6) } };
      if (p.length === 2 && m === 'PATCH') { const v = subIn(await readBody(req), s); q('UPDATE subs SET name=?, price=?, unit=?, every=?, start=?, category=?, notes=? WHERE id=?').run(v.name, v.price, v.unit, v.every, v.start, v.category, v.notes, id); return { body: dto(sub(id), today) }; }
      if (p.length === 2 && m === 'DELETE') { q('DELETE FROM subs WHERE id=?').run(id); return { status: 204 }; }
      if (p[2] === 'cancel' && m === 'POST') { if (s.cancelled_day) throw new HttpError(409, 'Already cancelled'); q('UPDATE subs SET cancelled_day=? WHERE id=?').run(today, id); return { body: dto(sub(id), today) }; }
      if (p[2] === 'resume' && m === 'POST') { if (!s.cancelled_day) throw new HttpError(409, 'Not cancelled'); q('UPDATE subs SET cancelled_day=NULL WHERE id=?').run(id); return { body: dto(sub(id), today) }; }
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
      if (rel === 'subs.js') return send(200, await readFile(join(SRC, 'subs.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/subtrack.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Subtrack listening on :${port}`));
}
