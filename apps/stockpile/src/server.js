import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { parseMoney, replay, dailyUsage, daysOfCover, isLow } from './inventory.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const MAX_QTY = 1_000_000;

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), unit TEXT NOT NULL DEFAULT 'pcs' CHECK(length(unit) BETWEEN 1 AND 12), reorder_point INTEGER NOT NULL DEFAULT 0 CHECK(reorder_point >= 0), archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE movements(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES items(id), day TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('receive','issue','adjust')), qty INTEGER NOT NULL CHECK(qty <> 0), unit_cost INTEGER CHECK(unit_cost IS NULL OR unit_cost >= 0), note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 120), created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE INDEX idx_mov_item ON movements(item_id, day, id);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 20_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const todayOf = (sp) => { const utc = now().toISOString().slice(0, 10), c = sp?.get('today'); return c && isDate(c) && Math.abs(Date.parse(c + 'T00:00:00Z') - Date.parse(utc + 'T00:00:00Z')) <= 86400000 ? c : utc; };
  const item = (id) => { const i = q('SELECT * FROM items WHERE id=?').get(id); if (!i) throw new HttpError(404, 'Item not found'); return i; };
  const movs = (itemId, upTo = '9999-12-31') => q('SELECT id, day, type, qty, unit_cost unitCost, note FROM movements WHERE item_id=? AND day<=? ORDER BY day, id').all(itemId, upTo);
  function summary(i, today) {
    const ms = movs(i.id), r = replay(ms), usage = dailyUsage(ms, today, 30);
    return { id: i.id, sku: i.sku, name: i.name, unit: i.unit, reorderPoint: i.reorder_point, archived: !!i.archived, onHand: r.onHand, value: r.value, usagePerDay: Math.round(usage * 100) / 100, daysOfCover: daysOfCover(r.onHand, usage), low: isLow(r.onHand, i.reorder_point) };
  }
  function itemIn(b, prev) {
    const d = {}, sku = (b.sku ?? prev?.sku ?? '').toString().trim().toUpperCase(), name = (b.name ?? prev?.name ?? '').toString().trim(), unit = (b.unit ?? prev?.unit ?? 'pcs').toString().trim(), rp = b.reorderPoint ?? prev?.reorder_point ?? 0;
    if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(sku)) d.sku = 'SKU must be 1–20 letters, digits, - or _'; if (!name || name.length > 80) d.name = 'Name is required (max 80 characters)'; if (!unit || unit.length > 12) d.unit = 'Unit is required (max 12 characters)'; if (!Number.isInteger(rp) || rp < 0 || rp > MAX_QTY) d.reorderPoint = 'Reorder point must be a whole number ≥ 0';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { sku, name, unit, rp };
  }
  const dup = (e) => { if (/UNIQUE/.test(e.message)) throw new HttpError(422, 'Validation failed', { sku: 'That SKU is already in use' }); throw e; };
  function addMovement(itemId, b, today) {
    const it = item(itemId), d = {}; if (it.archived) throw new HttpError(409, 'This item is archived');
    if (!['receive', 'issue', 'adjust'].includes(b.type)) d.type = 'Type must be receive, issue or adjust';
    const qty = b.qty; if (!Number.isInteger(qty) || qty === 0 || Math.abs(qty) > MAX_QTY) d.qty = 'Quantity must be a non-zero whole number'; else if (b.type !== 'adjust' && qty < 0) d.qty = 'Quantity must be positive (use an adjustment to remove stock you can’t explain)';
    const needsCost = b.type === 'receive' || (b.type === 'adjust' && qty > 0), unitCost = b.unitCost === '' || b.unitCost == null ? null : typeof b.unitCost === 'string' ? parseMoney(b.unitCost) : null;
    if (needsCost && unitCost === null) d.unitCost = 'Unit cost is required, like 2.50'; if (!needsCost && b.unitCost != null && b.unitCost !== '') d.unitCost = 'Unit cost only applies to receipts and positive adjustments';
    const day = b.day ?? today; if (!isDate(day) || day < '2000-01-01') d.day = 'Date must be a valid YYYY-MM-DD'; else if (day > today) d.day = 'You can’t record future movements';
    const note = typeof (b.note ?? '') === 'string' ? (b.note ?? '').trim() : null; if (note === null || note.length > 120) d.note = 'Note must be ≤ 120 characters';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
    const trial = replay([...movs(itemId), { id: 1e12, day, type: b.type, qty, unitCost: needsCost ? unitCost : null }]); if (!trial.ok) throw new HttpError(409, trial.error);
    const id = Number(q('INSERT INTO movements(item_id,day,type,qty,unit_cost,note) VALUES(?,?,?,?,?,?)').run(itemId, day, b.type, qty, needsCost ? unitCost : null, note).lastInsertRowid); return id;
  }
  function detail(i, today) {
    const ms = movs(i.id), r = replay(ms);
    return { ...summary(i, today), lots: r.lots, movements: [...ms].reverse().map((m) => ({ ...m, cost: r.cost.get(m.id) ?? 0, balance: r.balanceAfter.get(m.id) })) };
  }
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams, today = todayOf(sp);
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'items') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM items ORDER BY archived, sku').all().map((i) => summary(i, today)) };
      if (p.length === 1 && m === 'POST') { const v = itemIn(await readBody(req)); try { const r = q('INSERT INTO items(sku,name,unit,reorder_point) VALUES(?,?,?,?)').run(v.sku, v.name, v.unit, v.rp); return { status: 201, body: summary(item(Number(r.lastInsertRowid)), today) }; } catch (e) { dup(e); } }
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const it = item(id);
      if (p.length === 2 && m === 'GET') return { body: detail(it, today) };
      if (p.length === 2 && m === 'PATCH') { const b = await readBody(req); if (b.archived !== undefined && typeof b.archived !== 'boolean') throw new HttpError(422, 'Validation failed', { archived: 'archived must be true or false' }); const v = itemIn(b, it); try { q('UPDATE items SET sku=?, name=?, unit=?, reorder_point=?, archived=? WHERE id=?').run(v.sku, v.name, v.unit, v.rp, b.archived === undefined ? it.archived : b.archived ? 1 : 0, id); } catch (e) { dup(e); } return { body: summary(item(id), today) }; }
      if (p.length === 2 && m === 'DELETE') { if (q('SELECT 1 FROM movements WHERE item_id=?').get(id)) throw new HttpError(409, 'This item has stock history — archive it instead'); q('DELETE FROM items WHERE id=?').run(id); return { status: 204 }; }
      if (p[2] === 'movements' && m === 'POST') { addMovement(id, await readBody(req), today); return { status: 201, body: detail(item(id), today) }; }
    }
    if (p[0] === 'movements' && p[1] && m === 'DELETE') {
      const id = Number(p[1]), mv = q('SELECT * FROM movements WHERE id=?').get(id); if (!mv) throw new HttpError(404, 'Movement not found');
      const rest = movs(mv.item_id).filter((x) => x.id !== id), r = replay(rest); if (!r.ok) throw new HttpError(409, `Can’t remove this: ${r.error}`); q('DELETE FROM movements WHERE id=?').run(id); return { body: detail(item(mv.item_id), today) };
    }
    if (p[0] === 'reports') {
      if (p[1] === 'valuation' && m === 'GET') { const asOf = sp.get('asOf') ?? today; if (!isDate(asOf)) throw new HttpError(400, 'Invalid date'); const rows = q('SELECT * FROM items ORDER BY sku').all().map((i) => { const r = replay(movs(i.id, asOf)); return { sku: i.sku, name: i.name, onHand: r.onHand, value: r.value, avgCost: r.onHand ? Math.round(r.value / r.onHand) : null }; }).filter((r) => r.onHand > 0); return { body: { asOf, rows, total: rows.reduce((s, r) => s + r.value, 0) } }; }
      if (p[1] === 'cogs' && m === 'GET') {
        const to = sp.get('to') ?? today, from = sp.get('from') ?? to.slice(0, 8) + '01'; if (!isDate(to) || !isDate(from)) throw new HttpError(400, 'Invalid date'); if (from > to) throw new HttpError(422, 'Validation failed', { from: 'from must not be after to' });
        const rows = []; let cogs = 0, shrink = 0; for (const i of q('SELECT * FROM items ORDER BY sku').all()) { const ms = movs(i.id), r = replay(ms); let c = 0, s = 0; for (const mv of ms) { if (mv.day < from || mv.day > to) continue; if (mv.type === 'issue') c += r.cost.get(mv.id); else if (mv.type === 'adjust' && mv.qty < 0) s += r.cost.get(mv.id); } if (c || s) rows.push({ sku: i.sku, name: i.name, cogs: c, shrinkage: s }); cogs += c; shrink += s; }
        return { body: { from, to, rows, cogs, shrinkage: shrink } };
      }
      if (p[1] === 'low-stock' && m === 'GET') return { body: q('SELECT * FROM items WHERE archived=0').all().map((i) => summary(i, today)).filter((s) => s.low).sort((a, b) => (a.daysOfCover ?? 1e9) - (b.daysOfCover ?? 1e9) || a.sku.localeCompare(b.sku)) };
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
      if (rel === 'inventory.js') return send(200, await readFile(join(SRC, 'inventory.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/stockpile.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Stockpile listening on :${port}`));
}
