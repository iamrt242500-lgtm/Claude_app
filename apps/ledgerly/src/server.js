import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { TYPES, parseMoney, validateEntry, balanceOf, trialBalance, statements } from './ledger.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const CHART = [['1000', 'Cash', 'asset'], ['1100', 'Accounts Receivable', 'asset'], ['1500', 'Equipment', 'asset'], ['2000', 'Accounts Payable', 'liability'], ['2500', 'Loans Payable', 'liability'], ['3000', 'Owner’s Equity', 'equity'], ['4000', 'Sales', 'income'], ['5000', 'Rent', 'expense'], ['5100', 'Supplies', 'expense'], ['5200', 'Wages', 'expense']];

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE CHECK(code GLOB '[0-9A-Za-z]*' AND length(code) BETWEEN 2 AND 8), name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')), archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, memo TEXT NOT NULL CHECK(length(memo) BETWEEN 1 AND 200), voided_by INTEGER REFERENCES entries(id), reversal_of INTEGER REFERENCES entries(id), created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE lines(id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE, account_id INTEGER NOT NULL REFERENCES accounts(id), debit INTEGER NOT NULL DEFAULT 0 CHECK(debit >= 0), credit INTEGER NOT NULL DEFAULT 0 CHECK(credit >= 0), CHECK((debit > 0) <> (credit > 0)));
    CREATE INDEX idx_lines_account ON lines(account_id); CREATE INDEX idx_lines_entry ON lines(entry_id); CREATE INDEX idx_entries_day ON entries(day);
    PRAGMA user_version=1; COMMIT;`);
  if (!db.prepare('SELECT 1 FROM accounts').get()) { const ins = db.prepare('INSERT INTO accounts(code,name,type) VALUES(?,?,?)'); for (const a of CHART) ins.run(...a); }
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 100_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  let depth = 0; const tx = (fn) => { if (depth) return fn(); db.exec('BEGIN'); depth++; try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { depth--; } };   // re-entrant: inner calls join the outer transaction
  const todayOf = () => now().toISOString().slice(0, 10);
  const acct = (id) => { const a = q('SELECT * FROM accounts WHERE id=?').get(id); if (!a) throw new HttpError(404, 'Account not found'); return a; };
  const entryDto = (e) => ({ id: e.id, day: e.day, memo: e.memo, voidedBy: e.voided_by, reversalOf: e.reversal_of, lines: q('SELECT l.account_id accountId, a.code, a.name, l.debit, l.credit FROM lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=? ORDER BY l.id').all(e.id) });
  function createEntry(day, memo, rawLines, extra = {}) {
    const d = {}; if (!isDate(day)) d.day = 'Date must be a valid YYYY-MM-DD'; else if (day > '2100-01-01' || day < '2000-01-01') d.day = 'Date is out of range';
    memo = typeof memo === 'string' ? memo.trim() : ''; if (!memo) d.memo = 'Memo is required'; else if (memo.length > 200) d.memo = 'Memo must be ≤ 200 characters';
    const lines = []; if (Array.isArray(rawLines)) rawLines.forEach((l, i) => { const pm = (x) => (x === '' || x == null ? 0 : extra.internal ? x : typeof x === 'string' ? parseMoney(x) : null), debit = pm(l?.debit), credit = pm(l?.credit); if (debit === null || credit === null) d.lines = `Line ${i + 1}: amount must be text like "12.50"`; else lines.push({ account: l.account, debit, credit }); });
    if (!d.lines) { const v = validateEntry(lines); if (!v.ok) d.lines = v.errors.join('; '); }
    if (!d.lines) for (const [i, l] of lines.entries()) { const a = Number.isInteger(l.account) ? q('SELECT * FROM accounts WHERE id=?').get(l.account) : null; if (!a) { d.lines = `Line ${i + 1}: choose an account`; break; } if (a.archived) { d.lines = `Line ${i + 1}: account ${a.code} is archived`; break; } }
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
    return tx(() => { const id = Number(q('INSERT INTO entries(day,memo,reversal_of) VALUES(?,?,?)').run(day, memo, extra.reversalOf ?? null).lastInsertRowid); for (const l of lines) q('INSERT INTO lines(entry_id,account_id,debit,credit) VALUES(?,?,?,?)').run(id, l.account, l.debit, l.credit); return id; });
  }
  /** per-account totals through `to` (inclusive), optionally from `from` */
  const totals = (from, to) => q(`SELECT a.id, a.code, a.name, a.type, a.archived, COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit FROM accounts a LEFT JOIN lines l ON l.account_id=a.id AND l.entry_id IN (SELECT id FROM entries WHERE day BETWEEN ? AND ?) GROUP BY a.id ORDER BY a.code`).all(from, to);
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'accounts') {
      if (p.length === 1) {
        if (m === 'GET') return { body: totals('0000-01-01', '9999-12-31').map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, archived: !!a.archived, balance: balanceOf(a.type, a.debit, a.credit) })) };
        if (m === 'POST') {
          const b = await readBody(req), d = {}, code = typeof b.code === 'string' ? b.code.trim() : '', name = typeof b.name === 'string' ? b.name.trim() : '';
          if (!/^[0-9A-Za-z]{2,8}$/.test(code)) d.code = 'Code must be 2–8 letters or digits'; else if (q('SELECT 1 FROM accounts WHERE code=?').get(code)) d.code = 'That code is already used'; if (!name || name.length > 60) d.name = 'Name is required (max 60 characters)'; if (!TYPES.includes(b.type)) d.type = `Type must be one of ${TYPES.join(', ')}`;
          if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); const r = q('INSERT INTO accounts(code,name,type) VALUES(?,?,?)').run(code, name, b.type); const a = acct(Number(r.lastInsertRowid)); return { status: 201, body: { id: a.id, code, name, type: a.type, archived: false, balance: 0 } };
        }
      } else {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const a = acct(id);
        if (p[2] === 'ledger' && m === 'GET') { let run = 0; const rows = q('SELECT e.id entryId, e.day, e.memo, l.debit, l.credit FROM lines l JOIN entries e ON e.id=l.entry_id WHERE l.account_id=? ORDER BY e.day, e.id, l.id').all(id).map((r) => ({ ...r, balance: (run += balanceOf(a.type, r.debit, r.credit)) })); return { body: { account: { id, code: a.code, name: a.name, type: a.type }, rows } }; }
        if (p.length === 2 && m === 'PATCH') {
          const b = await readBody(req), d = {}; const used = q('SELECT 1 FROM lines WHERE account_id=?').get(id);
          if (b.name !== undefined) { const n = typeof b.name === 'string' ? b.name.trim() : ''; if (!n || n.length > 60) d.name = 'Name is required (max 60 characters)'; }
          if (b.type !== undefined && b.type !== a.type) { if (!TYPES.includes(b.type)) d.type = 'Unknown type'; else if (used) d.type = 'Type can’t change once the account has entries'; }
          if (b.archived !== undefined && typeof b.archived !== 'boolean') d.archived = 'archived must be true or false'; if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
          q('UPDATE accounts SET name=?, type=?, archived=? WHERE id=?').run(b.name !== undefined ? b.name.trim() : a.name, b.type ?? a.type, b.archived === undefined ? a.archived : b.archived ? 1 : 0, id); const t = totals('0000-01-01', '9999-12-31').find((x) => x.id === id); return { body: { id, code: t.code, name: t.name, type: t.type, archived: !!t.archived, balance: balanceOf(t.type, t.debit, t.credit) } };
        }
        if (p.length === 2 && m === 'DELETE') { if (q('SELECT 1 FROM lines WHERE account_id=?').get(id)) throw new HttpError(409, 'This account has entries — archive it instead'); q('DELETE FROM accounts WHERE id=?').run(id); return { status: 204 }; }
      }
    }
    if (p[0] === 'entries') {
      if (p.length === 1 && m === 'GET') {
        const from = sp.get('from') ?? '0000-01-01', to = sp.get('to') ?? '9999-12-31'; if ((sp.has('from') && !isDate(from)) || (sp.has('to') && !isDate(to))) throw new HttpError(400, 'Invalid date range'); const acc = sp.get('account') ? Number(sp.get('account')) : null;
        const rows = acc ? q('SELECT DISTINCT e.* FROM entries e JOIN lines l ON l.entry_id=e.id WHERE e.day BETWEEN ? AND ? AND l.account_id=? ORDER BY e.day DESC, e.id DESC LIMIT 500').all(from, to, acc) : q('SELECT * FROM entries WHERE day BETWEEN ? AND ? ORDER BY day DESC, id DESC LIMIT 500').all(from, to); return { body: rows.map(entryDto) };
      }
      if (p.length === 1 && m === 'POST') { const b = await readBody(req); const id = createEntry(b.day, b.memo, b.lines); return { status: 201, body: entryDto(q('SELECT * FROM entries WHERE id=?').get(id)) }; }
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const e = q('SELECT * FROM entries WHERE id=?').get(id); if (!e) throw new HttpError(404, 'Entry not found');
      if (p.length === 2 && m === 'GET') return { body: entryDto(e) };
      if (p[2] === 'void' && m === 'POST') {
        if (e.voided_by) throw new HttpError(409, 'Entry is already voided'); if (e.reversal_of) throw new HttpError(409, 'A reversal entry can’t be voided — post a new entry instead');
        const b = await readBody(req); const day = b.day ?? todayOf(); const orig = q('SELECT account_id account, debit, credit FROM lines WHERE entry_id=?').all(id); const rid = tx(() => { const rid = createEntry(day, `Void of #${id}: ${e.memo}`.slice(0, 200), orig.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })), { reversalOf: id, internal: true }); q('UPDATE entries SET voided_by=? WHERE id=?').run(rid, id); return rid; });
        return { body: entryDto(q('SELECT * FROM entries WHERE id=?').get(rid)) };
      }
    }
    if (p[0] === 'reports') {
      const to = sp.get('to') ?? todayOf(), from = sp.get('from') ?? to.slice(0, 4) + '-01-01'; if (!isDate(to) || !isDate(from)) throw new HttpError(400, 'Invalid date range'); if (from > to) throw new HttpError(422, 'Validation failed', { from: 'from must not be after to' });
      if (p[1] === 'trial-balance' && m === 'GET') { const tb = trialBalance(totals('0000-01-01', to)); return { body: { asOf: to, rows: tb.rows.map((r) => ({ code: r.code, name: r.name, type: r.type, debit: r.debitCol, credit: r.creditCol })), debit: tb.debit, credit: tb.credit, balanced: tb.balanced } }; }
      if (p[1] === 'statements' && m === 'GET') {
        const period = totals(from, to), cumulative = totals('0000-01-01', to), inc = period.filter((a) => a.type === 'income' && (a.debit || a.credit)).map((a) => ({ code: a.code, name: a.name, amount: balanceOf('income', a.debit, a.credit) })), exp = period.filter((a) => a.type === 'expense' && (a.debit || a.credit)).map((a) => ({ code: a.code, name: a.name, amount: balanceOf('expense', a.debit, a.credit) }));
        const sheet = statements(cumulative), group = (t) => cumulative.filter((a) => a.type === t && (a.debit || a.credit)).map((a) => ({ code: a.code, name: a.name, amount: balanceOf(t, a.debit, a.credit) }));
        return { body: { from, to, incomeStatement: { income: inc, expenses: exp, totalIncome: inc.reduce((s, x) => s + x.amount, 0), totalExpenses: exp.reduce((s, x) => s + x.amount, 0), netIncome: inc.reduce((s, x) => s + x.amount, 0) - exp.reduce((s, x) => s + x.amount, 0) }, balanceSheet: { assets: group('asset'), liabilities: group('liability'), equity: group('equity'), totalAssets: sheet.assets, totalLiabilities: sheet.liabilities, totalEquity: sheet.equity, retainedEarnings: sheet.netIncome, totalLiabilitiesAndEquity: sheet.liabilities + sheet.equityWithEarnings, balanced: sheet.balanced } } };
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
      if (rel === 'ledger.js') return send(200, await readFile(join(SRC, 'ledger.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/ledgerly.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Ledgerly listening on :${port}`));
}
