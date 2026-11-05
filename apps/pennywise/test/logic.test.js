import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseDate, isMonth, addMonths, daysInMonth, budgetStatus, summarizeMonth, parseTransactionsCsv, csvCell, isValidDate } from '../src/logic.js';

test('parseAmount: formats banks actually produce', () => {
  const ok = { '12.5': 1250, '$1,234.56': 123456, '(12.50)': -1250, '-12.5': -1250, '12.50-': -1250, '+7': 700, '  €3.05 ': 305, '1,000': 100000, '0.99': 99, '(-5)': 500 };
  for (const [s, c] of Object.entries(ok)) assert.equal(parseAmount(s), c, s);
  for (const bad of ['', null, 'abc', '1.234', '12,5', '1,23,456', '1e3', '--5', '$', '(', '12.']) assert.equal(parseAmount(bad), null, String(bad));
});
test('parseDate: formats, ambiguity requires explicit order, strict calendar validation', () => {
  assert.equal(parseDate('2026-03-09'), '2026-03-09'); assert.equal(parseDate('2026/3/9'), '2026-03-09'); assert.equal(parseDate('03/09/2026', 'mdy'), '2026-03-09'); assert.equal(parseDate('09/03/2026', 'dmy'), '2026-03-09');
  assert.equal(parseDate('3.9.26', 'mdy'), '2026-03-09'); assert.equal(parseDate('03/09/2026', 'ymd'), null, 'ambiguous without a declared order');
  for (const bad of ['2026-02-30', '2026-13-01', '13/01/2026', '', null, 'x', '2026-1-1-1']) assert.equal(parseDate(bad, 'mdy'), null, String(bad));
  assert.equal(parseDate('13/01/2026', 'dmy'), '2026-01-13'); assert.ok(isValidDate('2024-02-29') && !isValidDate('2026-02-29'));
});
test('month helpers', () => {
  assert.ok(isMonth('2026-03') && !isMonth('2026-13') && !isMonth('2026-3') && !isMonth(null)); assert.equal(addMonths('2026-12', 1), '2027-01'); assert.equal(addMonths('2026-01', -1), '2025-12'); assert.equal(addMonths('2026-03', -14), '2025-01');
  assert.equal(daysInMonth('2026-02'), 28); assert.equal(daysInMonth('2024-02'), 29); assert.equal(daysInMonth('2026-12'), 31);
});
test('budgetStatus thresholds', () => {
  assert.deepEqual(budgetStatus(0, 10000), { pct: 0, status: 'ok', remaining: 10000 }); assert.equal(budgetStatus(7999, 10000).status, 'ok'); assert.equal(budgetStatus(8000, 10000).status, 'warn');
  assert.equal(budgetStatus(10000, 10000).status, 'warn', 'exactly at budget is not over'); assert.equal(budgetStatus(10001, 10000).status, 'over'); assert.deepEqual(budgetStatus(500, null), { pct: null, status: 'none', remaining: null });
});
test('summarizeMonth: income/expense, per-category vs budget, uncategorized, daily series, other months ignored', () => {
  const cats = [{ id: 1, name: 'Food', budget: 50000 }, { id: 2, name: 'Fun', budget: null }, { id: 3, name: 'Rent', budget: 100000 }];
  const tx = [{ day: '2026-03-02', amount: 30000, type: 'expense', categoryId: 1 }, { day: '2026-03-02', amount: 25000, type: 'expense', categoryId: 1 }, { day: '2026-03-05', amount: 5000, type: 'expense', categoryId: null }, { day: '2026-03-31', amount: 100000, type: 'expense', categoryId: 3 },
    { day: '2026-03-01', amount: 400000, type: 'income', categoryId: null }, { day: '2026-02-28', amount: 99999, type: 'expense', categoryId: 1 }];
  const s = summarizeMonth(tx, cats, '2026-03');
  assert.equal(s.income, 400000); assert.equal(s.expense, 160000); assert.equal(s.net, 240000); assert.equal(s.count, 5);
  assert.deepEqual(s.categories.map((c) => [c.name, c.spent, c.status]), [['Rent', 100000, 'warn'], ['Food', 55000, 'over'], ['Uncategorized', 5000, 'none'], ['Fun', 0, 'none']]);
  assert.equal(s.daily.length, 31); assert.equal(s.daily[1].expense, 55000); assert.equal(s.daily[30].expense, 100000); assert.equal(s.totalBudget, 150000); assert.equal(s.budgetedSpent, 155000);
});
test('parseTransactionsCsv: signed amount, debit/credit columns, bad lines reported with line numbers', () => {
  const a = parseTransactionsCsv('Date,Description,Amount,Category\n2026-03-01,"Coffee, large",-4.50,Food\n2026-03-02,Salary,"2,500.00",\n2026-13-01,Bad date,-1,\n2026-03-03,Oops,abc,\n2026-03-04,Zero,0,\n');
  assert.equal(a.rows.length, 2); assert.deepEqual(a.rows[0], { line: 2, day: '2026-03-01', amount: 450, type: 'expense', note: 'Coffee, large', category: 'Food' }); assert.equal(a.rows[1].type, 'income');
  assert.deepEqual(a.errors.map((e) => [e.line, e.message.split(' ')[0]]), [[4, 'Invalid'], [5, 'Invalid'], [6, 'Amount']]);
  const b = parseTransactionsCsv('Posted;Memo;Debit;Credit\n03/05/2026;Rent;1200.00;\n03/06/2026;Refund;;15.25', { dateOrder: 'mdy' });
  assert.equal(b.errors.length, 0); assert.deepEqual(b.rows.map((r) => [r.day, r.amount, r.type]), [['2026-03-05', 120000, 'expense'], ['2026-03-06', 1525, 'income']]);
  assert.match(parseTransactionsCsv('foo,bar\n1,2').errors[0].message, /Could not find a date column/); assert.match(parseTransactionsCsv('').errors[0].message, /empty/); assert.match(parseTransactionsCsv('a,b\n"unterminated').errors[0].message, /Unterminated/);
  assert.match(parseTransactionsCsv('Date,Amount\n03/05/2026,5').errors[0].message, /choose a date format/);
});
test('csvCell neutralizes formula injection', () => { assert.equal(csvCell('=SUM(A1)'), `"'=SUM(A1)"`); assert.equal(csvCell('a"b'), '"a""b"'); assert.equal(csvCell('-5'), `"'-5"`); assert.equal(csvCell(null), '""'); });
