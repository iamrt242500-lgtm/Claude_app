import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { computeShares, balances, settleUp, toCents, SplitError } from './split.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const CURRENCIES = ['USD', 'EUR', 'GBP'], MAX_MEMBERS = 20, MAX_AMOUNT = 100_000_000_00;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE groups(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), currency TEXT NOT NULL CHECK(currency IN ('USD','EUR','GBP')), created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE members(id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40), UNIQUE(group_id, name COLLATE NOCASE));
    CREATE TABLE expenses(id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 120),
      amount INTEGER NOT NULL CHECK(amount > 0), paid_by INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT, day TEXT NOT NULL, split_type TEXT NOT NULL);
    CREATE TABLE shares(expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT, cents INTEGER NOT NULL CHECK(cents >= 0), PRIMARY KEY(expense_id, member_id)) WITHOUT ROWID;
    CREATE TABLE settlements(id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, from_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT, to_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
      amount INTEGER NOT NULL CHECK(amount > 0), day TEXT NOT NULL, CHECK(from_id <> to_id));
    CREATE INDEX idx_expenses_group ON expenses(group_id, day); PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 100_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const str = (v, field, max) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new HttpError(422, 'Validation failed', { [field]: `${field[0].toUpperCase() + field.slice(1)} is required` });
  if (s.length > max) throw new HttpError(422, 'Validation failed', { [field]: `${field[0].toUpperCase() + field.slice(1)} must be ≤ ${max} characters` });
  return s;
};

export function createApp({ dbPath = ':memory:', today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const group404 = (id) => { const g = q('SELECT * FROM groups WHERE id=?').get(id); if (!g) throw new HttpError(404, 'Group not found'); return g; };
  const detail = (gid) => {
    const g = group404(gid), members = q('SELECT id, name FROM members WHERE group_id=? ORDER BY id').all(gid), ids = members.map((m) => m.id);
    const ex = q('SELECT * FROM expenses WHERE group_id=? ORDER BY day DESC, id DESC').all(gid).map((e) => ({ id: e.id, description: e.description, amount: e.amount, paidBy: e.paid_by, day: e.day, splitType: e.split_type,
      shares: Object.fromEntries(q('SELECT member_id, cents FROM shares WHERE expense_id=? ORDER BY member_id').all(e.id).map((s) => [s.member_id, s.cents])) }));
    const st = q('SELECT * FROM settlements WHERE group_id=? ORDER BY day DESC, id DESC').all(gid).map((s) => ({ id: s.id, from: s.from_id, to: s.to_id, amount: s.amount, day: s.day }));
    const bal = balances(ids, ex, st);
    return { id: g.id, name: g.name, currency: g.currency, members, expenses: ex, settlements: st, balances: bal, suggestions: settleUp(bal), total: ex.reduce((s, e) => s + e.amount, 0) };
  };
  const memberOf = (gid, id) => { const m = q('SELECT * FROM members WHERE id=? AND group_id=?').get(Number(id), gid); if (!m) throw new HttpError(422, 'Validation failed', { member: 'Unknown member' }); return m; };
  function parseExpense(gid, b) {
    const d = {}, description = typeof b.description === 'string' ? b.description.trim() : '';
    if (!description) d.description = 'Description is required'; else if (description.length > 120) d.description = 'Description must be ≤ 120 characters';
    const amount = toCents(b.amount); if (amount == null || amount <= 0) d.amount = 'Enter a positive amount (up to 2 decimals)'; else if (amount > MAX_AMOUNT) d.amount = 'Amount too large';
    const day = b.day || today(); if (!isDate(day)) d.day = 'Invalid date';
    const payer = q('SELECT id FROM members WHERE id=? AND group_id=?').get(Number(b.paidBy), gid); if (!payer) d.paidBy = 'Choose who paid';
    let shares;
    if (!Object.keys(d).length) {
      try { shares = computeShares(amount, b.split); } catch (e) { if (e instanceof SplitError) d.split = e.message; else throw e; }
      if (shares) for (const id of Object.keys(shares)) if (!q('SELECT 1 FROM members WHERE id=? AND group_id=?').get(Number(id), gid)) d.split = 'Split includes an unknown member';
    }
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
    return { description, amount, day, paidBy: payer.id, splitType: b.split.type, shares };
  }
  const saveShares = (eid, shares) => { q('DELETE FROM shares WHERE expense_id=?').run(eid); for (const [id, c] of Object.entries(shares)) q('INSERT INTO shares(expense_id,member_id,cents) VALUES(?,?,?)').run(eid, Number(id), c); };

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] !== 'groups') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') return { body: q('SELECT g.id, g.name, g.currency, (SELECT COUNT(*) FROM members WHERE group_id=g.id) members, COALESCE((SELECT SUM(amount) FROM expenses WHERE group_id=g.id),0) total FROM groups g ORDER BY g.id DESC').all() };
      if (m === 'POST') {
        const b = await readBody(req), d = {}, name = typeof b.name === 'string' ? b.name.trim() : '';
        if (!name) d.name = 'Name is required'; else if (name.length > 80) d.name = 'Name must be ≤ 80 characters';
        if (!CURRENCIES.includes(b.currency ?? 'USD')) d.currency = 'Unsupported currency';
        const names = [];
        for (const x of Array.isArray(b.members) ? b.members : []) {
          const n = typeof x === 'string' ? x.trim() : ''; if (!n || d.members) continue;
          if (n.length > 40) d.members = 'Names must be ≤ 40 characters'; else if (names.some((y) => y.toLowerCase() === n.toLowerCase())) d.members = `Duplicate name "${n}"`; else names.push(n);
        }
        if (!d.members && names.length < 2) d.members = 'Add at least two people'; else if (!d.members && names.length > MAX_MEMBERS) d.members = `At most ${MAX_MEMBERS} people`;
        if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
        const gid = tx(() => { const gid = Number(q('INSERT INTO groups(name,currency) VALUES(?,?)').run(name, b.currency ?? 'USD').lastInsertRowid); names.forEach((n) => q('INSERT INTO members(group_id,name) VALUES(?,?)').run(gid, n)); return gid; });
        return { status: 201, body: detail(gid) };
      }
      throw new HttpError(405, 'Method not allowed');
    }
    const gid = Number(p[1]); if (!Number.isInteger(gid) || gid < 1) throw new HttpError(400, 'Invalid id'); group404(gid);
    if (p.length === 2) {
      if (m === 'GET') return { body: detail(gid) };
      if (m === 'DELETE') { tx(() => { q('DELETE FROM settlements WHERE group_id=?').run(gid); q('DELETE FROM expenses WHERE group_id=?').run(gid); q('DELETE FROM groups WHERE id=?').run(gid); }); return { status: 204 }; }
    }
    if (p[2] === 'members') {
      if (p.length === 3 && m === 'POST') {
        const n = str((await readBody(req)).name, 'name', 40);
        if (q('SELECT COUNT(*) n FROM members WHERE group_id=?').get(gid).n >= MAX_MEMBERS) throw new HttpError(409, `At most ${MAX_MEMBERS} people`);
        if (q('SELECT 1 FROM members WHERE group_id=? AND name=? COLLATE NOCASE').get(gid, n)) throw new HttpError(422, 'Validation failed', { name: `"${n}" is already in this group` });
        q('INSERT INTO members(group_id,name) VALUES(?,?)').run(gid, n); return { status: 201, body: detail(gid) };
      }
      if (p.length === 4 && m === 'DELETE') {
        const mid = Number(p[3]); memberOf(gid, mid);
        if (q('SELECT 1 FROM expenses WHERE paid_by=? UNION SELECT 1 FROM shares WHERE member_id=? UNION SELECT 1 FROM settlements WHERE from_id=? OR to_id=?').get(mid, mid, mid, mid)) throw new HttpError(409, 'This person is part of expenses or payments and cannot be removed');
        if (q('SELECT COUNT(*) n FROM members WHERE group_id=?').get(gid).n <= 2) throw new HttpError(409, 'A group needs at least two people');
        q('DELETE FROM members WHERE id=?').run(mid); return { body: detail(gid) };
      }
    }
    if (p[2] === 'expenses') {
      if (p.length === 3 && m === 'POST') { const v = parseExpense(gid, await readBody(req)); tx(() => { const eid = Number(q('INSERT INTO expenses(group_id,description,amount,paid_by,day,split_type) VALUES(?,?,?,?,?,?)').run(gid, v.description, v.amount, v.paidBy, v.day, v.splitType).lastInsertRowid); saveShares(eid, v.shares); }); return { status: 201, body: detail(gid) }; }
      if (p.length === 4) {
        const eid = Number(p[3]); if (!q('SELECT 1 FROM expenses WHERE id=? AND group_id=?').get(eid, gid)) throw new HttpError(404, 'Expense not found');
        if (m === 'PUT') { const v = parseExpense(gid, await readBody(req)); tx(() => { q('UPDATE expenses SET description=?, amount=?, paid_by=?, day=?, split_type=? WHERE id=?').run(v.description, v.amount, v.paidBy, v.day, v.splitType, eid); saveShares(eid, v.shares); }); return { body: detail(gid) }; }
        if (m === 'DELETE') { q('DELETE FROM expenses WHERE id=?').run(eid); return { body: detail(gid) }; }
      }
    }
    if (p[2] === 'settlements') {
      if (p.length === 3 && m === 'POST') {
        const b = await readBody(req), amount = toCents(b.amount), d = {};
        const from = q('SELECT id FROM members WHERE id=? AND group_id=?').get(Number(b.from), gid), to = q('SELECT id FROM members WHERE id=? AND group_id=?').get(Number(b.to), gid);
        if (!from) d.from = 'Choose who paid'; if (!to) d.to = 'Choose who received'; if (from && to && from.id === to.id) d.to = 'Payer and receiver must differ';
        if (amount == null || amount <= 0) d.amount = 'Enter a positive amount'; else if (amount > MAX_AMOUNT) d.amount = 'Amount too large';
        const day = b.day || today(); if (!isDate(day)) d.day = 'Invalid date';
        if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
        q('INSERT INTO settlements(group_id,from_id,to_id,amount,day) VALUES(?,?,?,?,?)').run(gid, from.id, to.id, amount, day); return { status: 201, body: detail(gid) };
      }
      if (p.length === 4 && m === 'DELETE') { const r = q('DELETE FROM settlements WHERE id=? AND group_id=?').run(Number(p[3]), gid); if (!r.changes) throw new HttpError(404, 'Payment not found'); return { body: detail(gid) }; }
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/evenly.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Evenly listening on :${port}`));
}
