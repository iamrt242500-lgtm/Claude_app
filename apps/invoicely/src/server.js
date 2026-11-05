import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { totals, validateInvoice, todayUtc, lineTotal } from './money.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const TRANSITIONS = { draft: ['sent'], sent: ['paid', 'draft'], paid: ['sent'] };

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE clients(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100), email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '');
    CREATE TABLE invoices(id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      issue_date TEXT NOT NULL, due_date TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency IN ('USD','EUR','GBP')), tax_bp INTEGER NOT NULL CHECK(tax_bp BETWEEN 0 AND 10000),
      notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','paid')), paid_at TEXT, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, position INTEGER NOT NULL,
      description TEXT NOT NULL, qty REAL NOT NULL CHECK(qty > 0), unit_cents INTEGER NOT NULL CHECK(unit_cents >= 0));
    CREATE INDEX idx_invoices_status ON invoices(status, due_date); CREATE INDEX idx_items_invoice ON items(invoice_id);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 300_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:', today = todayUtc } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  const clientIn = (b) => {
    const name = typeof b.name === 'string' ? b.name.trim() : '', email = typeof b.email === 'string' ? b.email.trim() : '', address = typeof b.address === 'string' ? b.address.trim() : '';
    const d = {};
    if (!name) d.name = 'Name is required'; else if (name.length > 100) d.name = 'Name must be ≤ 100 characters';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) d.email = 'Invalid email address';
    if (address.length > 500) d.address = 'Address too long';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
    return { name, email, address };
  };
  const clientOr404 = (id) => { const c = q('SELECT * FROM clients WHERE id=?').get(id); if (!c) throw new HttpError(404, 'Client not found'); return c; };
  const view = (inv, full) => {
    const items = q('SELECT description, qty, unit_cents FROM items WHERE invoice_id=? ORDER BY position').all(inv.id).map((i) => ({ description: i.description, qty: i.qty, unitCents: i.unit_cents, lineCents: lineTotal(i.qty, i.unit_cents) }));
    const t = totals(items, inv.tax_bp), client = q('SELECT * FROM clients WHERE id=?').get(inv.client_id);
    const overdue = inv.status === 'sent' && inv.due_date < today();
    const base = { id: inv.id, number: inv.number, clientId: inv.client_id, clientName: client.name, issueDate: inv.issue_date, dueDate: inv.due_date, currency: inv.currency, status: inv.status, overdue, paidAt: inv.paid_at, ...t };
    return full ? { ...base, taxPercent: inv.tax_bp / 100, notes: inv.notes, items, client } : base;
  };
  const invOr404 = (id) => { const i = q('SELECT * FROM invoices WHERE id=?').get(id); if (!i) throw new HttpError(404, 'Invoice not found'); return i; };
  const writeItems = (id, items) => { q('DELETE FROM items WHERE invoice_id=?').run(id); items.forEach((it, i) => q('INSERT INTO items(invoice_id,position,description,qty,unit_cents) VALUES(?,?,?,?,?)').run(id, i, it.description, it.qty, it.unitCents)); };
  const parsedInvoice = (b) => {
    const r = validateInvoice(b); if (r.errors) throw new HttpError(422, 'Validation failed', r.errors);
    clientOr404(r.value.clientId); return r.value;
  };

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'summary' && m === 'GET') {
      const all = q('SELECT * FROM invoices').all().map((i) => view(i, false)), T = today();
      const byCur = {}; const cur = (c) => (byCur[c] ??= { currency: c, outstanding: 0, overdue: 0, paidThisYear: 0 });
      const months = new Map();
      for (const i of all) {
        if (i.status === 'sent') { cur(i.currency).outstanding += i.total; if (i.overdue) cur(i.currency).overdue += i.total; }
        if (i.status === 'paid' && i.paidAt?.slice(0, 4) === T.slice(0, 4)) cur(i.currency).paidThisYear += i.total;
        if (i.status === 'paid' && i.paidAt) { const k = `${i.currency} ${i.paidAt.slice(0, 7)}`; months.set(k, (months.get(k) || 0) + i.total); }
      }
      return { body: { counts: { draft: all.filter((i) => i.status === 'draft').length, sent: all.filter((i) => i.status === 'sent').length, paid: all.filter((i) => i.status === 'paid').length, overdue: all.filter((i) => i.overdue).length },
        currencies: Object.values(byCur), revenueByMonth: [...months.entries()].sort().slice(-12).map(([k, total]) => ({ currency: k.slice(0, 3), month: k.slice(4), total })) } };
    }
    if (p[0] === 'clients') {
      if (p.length === 1) {
        if (m === 'GET') return { body: q('SELECT c.*, (SELECT COUNT(*) FROM invoices i WHERE i.client_id=c.id) invoices FROM clients c ORDER BY name COLLATE NOCASE').all() };
        if (m === 'POST') { const c = clientIn(await readBody(req)); const r = q('INSERT INTO clients(name,email,address) VALUES(?,?,?)').run(c.name, c.email, c.address); return { status: 201, body: clientOr404(Number(r.lastInsertRowid)) }; }
      } else {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); clientOr404(id);
        if (m === 'PUT') { const c = clientIn(await readBody(req)); q('UPDATE clients SET name=?, email=?, address=? WHERE id=?').run(c.name, c.email, c.address, id); return { body: clientOr404(id) }; }
        if (m === 'DELETE') {
          if (q('SELECT COUNT(*) n FROM invoices WHERE client_id=?').get(id).n) throw new HttpError(409, 'This client has invoices and cannot be deleted');
          q('DELETE FROM clients WHERE id=?').run(id); return { status: 204 };
        }
      }
    }
    if (p[0] === 'invoices') {
      if (p.length === 1) {
        if (m === 'GET') { const st = url.searchParams.get('status'); let rows = q('SELECT * FROM invoices ORDER BY id DESC').all().map((i) => view(i, false)); if (st === 'overdue') rows = rows.filter((r) => r.overdue); else if (st) rows = rows.filter((r) => r.status === st); return { body: rows }; }
        if (m === 'POST') {
          const v = parsedInvoice(await readBody(req));
          const id = tx(() => {
            const next = (q('SELECT COALESCE(MAX(id),0)+1 n FROM invoices').get().n);
            const r = q('INSERT INTO invoices(number,client_id,issue_date,due_date,currency,tax_bp,notes) VALUES(?,?,?,?,?,?,?)').run(`INV-${String(next).padStart(4, '0')}`, v.clientId, v.issueDate, v.dueDate, v.currency, v.taxBp, v.notes);
            const id = Number(r.lastInsertRowid); writeItems(id, v.items); return id;
          });
          return { status: 201, body: view(invOr404(id), true) };
        }
      } else {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const inv = invOr404(id);
        if (!p[2]) {
          if (m === 'GET') return { body: view(inv, true) };
          if (m === 'PUT') {
            if (inv.status !== 'draft') throw new HttpError(409, 'Only draft invoices can be edited. Move it back to draft first.');
            const v = parsedInvoice(await readBody(req));
            tx(() => { q('UPDATE invoices SET client_id=?, issue_date=?, due_date=?, currency=?, tax_bp=?, notes=? WHERE id=?').run(v.clientId, v.issueDate, v.dueDate, v.currency, v.taxBp, v.notes, id); writeItems(id, v.items); });
            return { body: view(invOr404(id), true) };
          }
          if (m === 'DELETE') { if (inv.status !== 'draft') throw new HttpError(409, 'Only draft invoices can be deleted'); q('DELETE FROM invoices WHERE id=?').run(id); return { status: 204 }; }
        }
        if (p[2] === 'status' && m === 'POST') {
          const to = (await readBody(req)).status;
          if (!TRANSITIONS[inv.status].includes(to)) throw new HttpError(409, `Cannot change status from ${inv.status} to ${to}`);
          q('UPDATE invoices SET status=?, paid_at=? WHERE id=?').run(to, to === 'paid' ? today() : null, id);
          return { body: view(invOr404(id), true) };
        }
      }
    }
    throw new HttpError(m === 'GET' || m === 'POST' || m === 'PUT' || m === 'DELETE' ? 404 : 405, 'Not found');
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/invoicely.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Invoicely listening on :${port}`));
}
