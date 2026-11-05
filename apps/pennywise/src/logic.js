// Pure budgeting logic. Money is integer cents (always positive in storage; `type` carries the sign).
import { parseCsv } from './csv.js';

/** "$1,234.56" | "(12.50)" | "-12.5" | "12.50-" | "1 234,56"? (no) -> signed cents, or null. */
export function parseAmount(input) {
  let s = String(input ?? '').trim(); if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$€£\s]/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ''] = s.replace(/,/g, '').split('.'); const c = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return Number.isSafeInteger(c) ? (neg ? -c : c) : null;
}
export const isValidDate = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
/** order: 'ymd' | 'mdy' | 'dmy'. Accepts - / . separators; 2-digit years -> 2000+. Returns YYYY-MM-DD or null. */
export function parseDate(input, order = 'ymd') {
  const m = /^\s*(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})\s*$/.exec(String(input ?? '')); if (!m) return null;
  let y, mo, d;
  if (m[1].length === 4) [y, mo, d] = [m[1], m[2], m[3]];
  else if (order === 'mdy') [mo, d, y] = [m[1], m[2], m[3]];
  else if (order === 'dmy') [d, mo, y] = [m[1], m[2], m[3]];
  else return null;
  if (y.length === 2) y = '20' + y; if (y.length !== 4) return null;
  const out = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; return isValidDate(out) ? out : null;
}
export const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const addMonths = (month, n) => { const [y, m] = month.split('-').map(Number), t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
export const daysInMonth = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

export function budgetStatus(spent, budget) {
  if (!budget) return { pct: null, status: 'none', remaining: null };
  const pct = Math.round((spent / budget) * 100);
  return { pct, status: spent > budget ? 'over' : spent * 5 >= budget * 4 ? 'warn' : 'ok', remaining: budget - spent };   // integer compare: 79.99% must not round up into 'warn'
}
/** txs: [{day, amount, type, categoryId}], cats: [{id,name,budget}] */
export function summarizeMonth(txs, cats, month) {
  const inMonth = txs.filter((t) => t.day.startsWith(month));
  const income = inMonth.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0), expense = inMonth.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const spentBy = new Map(); for (const t of inMonth) if (t.type === 'expense') spentBy.set(t.categoryId ?? 0, (spentBy.get(t.categoryId ?? 0) || 0) + t.amount);
  const categories = cats.map((c) => ({ id: c.id, name: c.name, budget: c.budget, spent: spentBy.get(c.id) || 0, ...budgetStatus(spentBy.get(c.id) || 0, c.budget) }));
  if (spentBy.get(0)) categories.push({ id: null, name: 'Uncategorized', budget: null, spent: spentBy.get(0), ...budgetStatus(spentBy.get(0), null) });
  categories.sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name));
  const n = daysInMonth(month), daily = Array.from({ length: n }, (_, i) => ({ day: `${month}-${String(i + 1).padStart(2, '0')}`, expense: 0 }));
  for (const t of inMonth) if (t.type === 'expense') daily[Number(t.day.slice(8)) - 1].expense += t.amount;
  const totalBudget = cats.reduce((s, c) => s + (c.budget || 0), 0), budgetedSpent = categories.filter((c) => c.budget).reduce((s, c) => s + c.spent, 0);
  return { month, income, expense, net: income - expense, categories, daily, totalBudget, budgetedSpent, count: inMonth.length };
}

const SYN = { date: ['date', 'transaction date', 'posted', 'posting date', 'day'], amount: ['amount', 'value', 'sum', 'total'], debit: ['debit', 'withdrawal', 'withdrawals', 'out'], credit: ['credit', 'deposit', 'deposits', 'in'], note: ['description', 'memo', 'note', 'details', 'payee', 'name', 'merchant'], category: ['category', 'type', 'tag'] };
/** Parse bank-style CSV text into transactions, reporting per-line problems instead of failing the whole file. */
export function parseTransactionsCsv(text, { dateOrder = 'ymd', maxRows = 5000 } = {}) {
  let parsed; try { parsed = parseCsv(text); } catch (e) { return { rows: [], errors: [{ line: 1, message: e.message }], columns: null }; }
  const [head, ...body] = parsed.rows; if (!head) return { rows: [], errors: [{ line: 1, message: 'The file is empty' }], columns: null };
  const names = head.map((h) => h.trim().toLowerCase()), find = (k) => names.findIndex((n) => SYN[k].includes(n));
  const col = { date: find('date'), amount: find('amount'), debit: find('debit'), credit: find('credit'), note: find('note'), category: find('category') };
  if (col.date < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) return { rows: [], errors: [{ line: 1, message: 'Could not find a date column and an amount (or debit/credit) column in the header row' }], columns: col };
  if (body.length > maxRows) return { rows: [], errors: [{ line: 1, message: `Too many rows (max ${maxRows})` }], columns: col };
  const rows = [], errors = [];
  body.forEach((r, i) => {
    const line = i + 2, day = parseDate(r[col.date], dateOrder); let cents = null;
    if (col.amount >= 0 && String(r[col.amount] ?? '').trim()) cents = parseAmount(r[col.amount]);
    else { const d = col.debit >= 0 ? parseAmount(r[col.debit]) : null, c = col.credit >= 0 ? parseAmount(r[col.credit]) : null; if (d) cents = -Math.abs(d); else if (c) cents = Math.abs(c); }
    if (!day) return errors.push({ line, message: `Invalid date "${r[col.date] ?? ''}"${dateOrder === 'ymd' ? ' (expected YYYY-MM-DD; choose a date format for other styles)' : ''}` });
    if (cents == null) return errors.push({ line, message: `Invalid amount "${col.amount >= 0 ? r[col.amount] ?? '' : ''}"` });
    if (cents === 0) return errors.push({ line, message: 'Amount is zero' });
    rows.push({ line, day, amount: Math.abs(cents), type: cents < 0 ? 'expense' : 'income', note: String(r[col.note] ?? '').trim().slice(0, 200), category: col.category >= 0 ? String(r[col.category] ?? '').trim().slice(0, 40) : '' });
  });
  return { rows, errors, columns: col };
}
export const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replaceAll('"', '""')}"`; };
