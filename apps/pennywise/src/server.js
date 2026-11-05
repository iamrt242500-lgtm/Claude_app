import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { parseAmount, isValidDate, isMonth, addMonths, summarizeMonth, parseTransactionsCsv, csvCell } from './logic.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const MAX_CENTS = 100_000_000_00;

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE categories(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 40), budget INTEGER CHECK(budget IS NULL OR budget > 0));
    CREATE TABLE transactions(id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), type TEXT NOT NULL CHECK(type IN ('income','expense')),
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE INDEX idx_tx_day ON transactions(day); CREATE INDEX idx_tx_cat ON transactions(category_id);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req, max = 2_500_000) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > max) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const thisMonth = () => now().toISOString().slice(0, 7);
  const catDto = (c) => ({ id: c.id, name: c.name, budget: c.budget });
  const txDto = (t) => ({ id: t.id, day: t.day, amount: t.amount, type: t.type, categoryId: t.category_id, categoryName: t.category_name ?? null, note: t.note });
  const cat404 = (id) => { const c = q('SELECT * FROM categories WHERE id=?').get(id); if (!c) throw new HttpError(404, 'Category not found'); return c; };
  const tx404 = (id) => { const t = q('SELECT t.*, c.name category_name FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.id=?').get(id); if (!t) throw new HttpError(404, 'Transaction not found'); return t; };

  function catIn(b) {
    const d = {}, name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) d.name = 'Name is required'; else if (name.length > 40) d.name = 'Name must be ≤ 40 characters';
    let budget = null; if (b.budget !== null && b.budget !== undefined && String(b.budget).trim() !== '') { const c = parseAmount(b.budget); if (c == null || c <= 0 || c > MAX_CENTS) d.budget = 'Budget must be a positive amount'; else budget = c; }
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { name, budget };
  }
  function txIn(b) {
    const d = {}, type = b.type; if (!['income', 'expense'].includes(type)) d.type = 'Choose income or expense';
    const cents = parseAmount(b.amount); if (cents == null || cents <= 0) d.amount = 'Enter a positive amount (up to 2 decimals)'; else if (cents > MAX_CENTS) d.amount = 'Amount too large';
    if (!isValidDate(b.day)) d.day = 'Invalid date';
    const note = typeof b.note === 'string' ? b.note.trim() : ''; if (note.length > 200) d.note = 'Note must be ≤ 200 characters';
    let categoryId = null; if (b.categoryId !== null && b.categoryId !== undefined && b.categoryId !== '') { categoryId = Number(b.categoryId); if (!Number.isInteger(categoryId) || !q('SELECT 1 FROM categories WHERE id=?').get(categoryId)) d.categoryId = 'Unknown category'; }
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { type, amount: cents, day: b.day, note, categoryId };
  }
  const allTx = () => q('SELECT day, amount, type, category_id categoryId FROM transactions').all();
  const allCats = () => q('SELECT id, name, budget FROM categories ORDER BY name COLLATE NOCASE').all();

  function listTx(sp) {
    const where = [], args = [];
    if (sp.get('month')) { if (!isMonth(sp.get('month'))) throw new HttpError(422, 'Validation failed', { month: 'month must be YYYY-MM' }); where.push('t.day LIKE ?'); args.push(sp.get('month') + '-%'); }
    if (sp.get('categoryId') === 'none') where.push('t.category_id IS NULL'); else if (sp.get('categoryId')) { where.push('t.category_id = ?'); args.push(Number(sp.get('categoryId'))); }
    if (sp.get('type') && ['income', 'expense'].includes(sp.get('type'))) { where.push('t.type = ?'); args.push(sp.get('type')); }
    if (sp.get('q')) { where.push("t.note LIKE ? ESCAPE '\\'"); args.push('%' + sp.get('q').replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
    return q(`SELECT t.*, c.name category_name FROM transactions t LEFT JOIN categories c ON c.id=t.category_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.day DESC, t.id DESC LIMIT 1000`).all(...args).map(txDto);
  }
  const dupKey = (r) => `${r.day}|${r.amount}|${r.type}|${r.note.toLowerCase()}`;
  function importPlan(b) {
    if (typeof b.csv !== 'string' || !b.csv.trim()) throw new HttpError(422, 'Validation failed', { csv: 'CSV content is required' });
    if (!['ymd', 'mdy', 'dmy'].includes(b.dateOrder ?? 'ymd')) throw new HttpError(422, 'Validation failed', { dateOrder: 'dateOrder must be ymd, mdy or dmy' });
    const r = parseTransactionsCsv(b.csv, { dateOrder: b.dateOrder ?? 'ymd' });
    const existing = new Set(q('SELECT day, amount, type, note FROM transactions').all().map(dupKey)), seen = new Set(), fresh = [], dupes = [];
    for (const row of r.rows) { const k = dupKey(row); if (existing.has(k) || seen.has(k)) dupes.push(row); else { seen.add(k); fresh.push(row); } }
    return { ...r, fresh, dupes };
  }

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'categories') {
      if (p.length === 1) {
        if (m === 'GET') return { body: allCats().map(catDto) };
        if (m === 'POST') { const v = catIn(await readBody(req)); if (q('SELECT 1 FROM categories WHERE name=?').get(v.name)) throw new HttpError(422, 'Validation failed', { name: `"${v.name}" already exists` }); const r = q('INSERT INTO categories(name,budget) VALUES(?,?)').run(v.name, v.budget); return { status: 201, body: catDto(cat404(Number(r.lastInsertRowid))) }; }
      } else {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); cat404(id);
        if (m === 'PUT') { const v = catIn(await readBody(req)); const dup = q('SELECT id FROM categories WHERE name=?').get(v.name); if (dup && dup.id !== id) throw new HttpError(422, 'Validation failed', { name: `"${v.name}" already exists` }); q('UPDATE categories SET name=?, budget=? WHERE id=?').run(v.name, v.budget, id); return { body: catDto(cat404(id)) }; }
        if (m === 'DELETE') { q('DELETE FROM categories WHERE id=?').run(id); return { status: 204 }; }   // transactions keep existing, become uncategorized
      }
    }
    if (p[0] === 'transactions') {
      if (p.length === 1) {
        if (m === 'GET') return { body: listTx(sp) };
        if (m === 'POST') { const v = txIn(await readBody(req)); const r = q('INSERT INTO transactions(day,amount,type,category_id,note) VALUES(?,?,?,?,?)').run(v.day, v.amount, v.type, v.categoryId, v.note); return { status: 201, body: txDto(tx404(Number(r.lastInsertRowid))) }; }
      } else {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); tx404(id);
        if (m === 'GET') return { body: txDto(tx404(id)) };
        if (m === 'PUT') { const v = txIn(await readBody(req)); q('UPDATE transactions SET day=?, amount=?, type=?, category_id=?, note=? WHERE id=?').run(v.day, v.amount, v.type, v.categoryId, v.note, id); return { body: txDto(tx404(id)) }; }
        if (m === 'DELETE') { q('DELETE FROM transactions WHERE id=?').run(id); return { status: 204 }; }
      }
    }
    if (p[0] === 'summary' && m === 'GET') {
      const month = sp.get('month') || thisMonth(); if (!isMonth(month)) throw new HttpError(422, 'Validation failed', { month: 'month must be YYYY-MM' });
      const txs = allTx(), cats = allCats();
      return { body: { ...summarizeMonth(txs, cats, month), trend: Array.from({ length: 6 }, (_, i) => { const mo = addMonths(month, i - 5), s = summarizeMonth(txs, cats, mo); return { month: mo, income: s.income, expense: s.expense }; }), current: thisMonth() } };
    }
    if (p[0] === 'export' && m === 'GET') {
      const rows = q('SELECT t.*, c.name category_name FROM transactions t LEFT JOIN categories c ON c.id=t.category_id ORDER BY t.day, t.id').all();
      const csv = ['date,description,amount,category', ...rows.map((t) => [t.day, csvCell(t.note), (t.type === 'expense' ? '-' : '') + (t.amount / 100).toFixed(2), csvCell(t.category_name ?? '')].join(','))].join('\n');
      return { raw: csv, headers: { 'Content-Disposition': 'attachment; filename="pennywise.csv"' } };
    }
    if (p[0] === 'import' && m === 'POST') {
      const b = await readBody(req), plan = importPlan(b), dry = b.dryRun !== false;
      const summary = { total: plan.rows.length + plan.errors.length, valid: plan.rows.length, duplicates: plan.dupes.length, toImport: plan.fresh.length, errors: plan.errors.slice(0, 50), errorCount: plan.errors.length };
      if (dry) return { body: { dryRun: true, ...summary, preview: plan.fresh.slice(0, 10) } };
      if (plan.errors.length && !b.skipInvalid) throw new HttpError(422, 'Validation failed', { csv: `${plan.errors.length} invalid line(s). Fix them or choose to skip invalid lines.` });
      const created = [];
      tx(() => { for (const r of plan.fresh) {
        let cid = null; if (r.category) { const c = q('SELECT id FROM categories WHERE name=?').get(r.category) ?? { id: Number(q('INSERT INTO categories(name) VALUES(?)').run(r.category).lastInsertRowid) }; cid = c.id; if (!created.includes(c.id)) created.push(c.id); }
        q('INSERT INTO transactions(day,amount,type,category_id,note) VALUES(?,?,?,?,?)').run(r.day, r.amount, r.type, cid, r.note); } });
      return { status: 201, body: { dryRun: false, ...summary, imported: plan.fresh.length } };
    }
    throw new HttpError(404, 'Not found');
  }

  const server = createServer(async (req, res) => {
    const send = (s, b, t = 'application/json; charset=utf-8', h = {}) => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store', ...h }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url); if (r.raw !== undefined) return send(200, r.raw, 'text/csv; charset=utf-8', r.headers); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body)); }
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/pennywise.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Pennywise listening on :${port}`));
}
