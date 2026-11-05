// Double-entry bookkeeping rules. Pure; shared by server and browser. Money = integer cents.
export const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
/** Debit-normal types increase with debits. */
export const DEBIT_NORMAL = new Set(['asset', 'expense']);

/** "12.5" → 1250, "1,234.56" → 123456, "$3" → 300; null if not a non-negative amount with ≤ 2 decimals. */
export function parseMoney(input) {
  if (typeof input === 'number') return Number.isInteger(input) && input >= 0 ? input : null;
  if (typeof input !== 'string') return null; const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s); if (!m) return null; return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
}
export function formatMoney(cents) { const neg = cents < 0, a = Math.abs(cents), s = `${Math.floor(a / 100).toLocaleString('en-US')}.${String(a % 100).padStart(2, '0')}`; return neg ? `-${s}` : s; }

/**
 * Validate a journal entry's lines: [{ account, debit, credit }] in cents.
 * Returns { ok, errors[], debit, credit }. A valid entry has ≥ 2 lines, each with exactly one positive side, and balances.
 */
export function validateEntry(lines) {
  const errors = []; let debit = 0, credit = 0;
  if (!Array.isArray(lines) || lines.length < 2) return { ok: false, errors: ['An entry needs at least two lines'], debit: 0, credit: 0 };
  lines.forEach((l, i) => {
    const d = l.debit || 0, c = l.credit || 0;
    if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0) errors.push(`Line ${i + 1}: amounts must be non-negative whole cents`);
    else if ((d > 0) === (c > 0)) errors.push(`Line ${i + 1}: enter either a debit or a credit, not ${d > 0 ? 'both' : 'neither'}`);
    debit += d; credit += c;
  });
  if (!errors.length && debit !== credit) errors.push(`Entry is out of balance by ${formatMoney(Math.abs(debit - credit))} (debits ${formatMoney(debit)}, credits ${formatMoney(credit)})`);
  return { ok: !errors.length, errors, debit, credit };
}
/** Natural-sign balance of an account given total debits and credits. */
export const balanceOf = (type, debit, credit) => (DEBIT_NORMAL.has(type) ? debit - credit : credit - debit);
/**
 * Trial balance rows from [{ id, code, name, type, debit, credit }] (period totals).
 * Each account is shown in its normal column; a negative natural balance goes to the other column.
 */
export function trialBalance(accounts) {
  const rows = accounts.filter((a) => a.debit || a.credit).map((a) => { const b = balanceOf(a.type, a.debit, a.credit), debitSide = DEBIT_NORMAL.has(a.type) ? b >= 0 : b < 0; return { ...a, balance: b, debitCol: debitSide ? Math.abs(b) : 0, creditCol: debitSide ? 0 : Math.abs(b) }; });
  const debit = rows.reduce((s, r) => s + r.debitCol, 0), credit = rows.reduce((s, r) => s + r.creditCol, 0); return { rows, debit, credit, balanced: debit === credit };
}
/** Income statement + balance sheet from account balances. Net income flows into equity. */
export function statements(accounts) {
  const sum = (t) => accounts.filter((a) => a.type === t).reduce((s, a) => s + balanceOf(a.type, a.debit, a.credit), 0);
  const income = sum('income'), expense = sum('expense'), assets = sum('asset'), liabilities = sum('liability'), equity = sum('equity'), net = income - expense;
  return { income, expense, netIncome: net, assets, liabilities, equity, equityWithEarnings: equity + net, balanced: assets === liabilities + equity + net };
}
