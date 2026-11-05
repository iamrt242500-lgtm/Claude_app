import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, formatMoney, validateEntry, balanceOf, trialBalance, statements } from '../src/ledger.js';

test('parseMoney', () => {
  assert.equal(parseMoney('12.5'), 1250); assert.equal(parseMoney('1,234.56'), 123456); assert.equal(parseMoney('$3'), 300); assert.equal(parseMoney('0.07'), 7); assert.equal(parseMoney(' 10 '), 1000); assert.equal(parseMoney(250), 250); assert.equal(parseMoney('0'), 0);
  for (const bad of ['', '-5', '1.234', 'abc', '1e3', '1.', '.5', null, 1.5, -1, '9999999999999']) assert.equal(parseMoney(bad), null, String(bad));
});
test('formatMoney', () => { assert.equal(formatMoney(123456), '1,234.56'); assert.equal(formatMoney(5), '0.05'); assert.equal(formatMoney(-250), '-2.50'); assert.equal(formatMoney(0), '0.00'); });
test('validateEntry: balanced, unbalanced, malformed lines', () => {
  assert.deepEqual(validateEntry([{ account: 1, debit: 500 }, { account: 2, credit: 500 }]), { ok: true, errors: [], debit: 500, credit: 500 });
  assert.equal(validateEntry([{ debit: 100 }, { debit: 200 }, { credit: 300 }]).ok, true, 'split entries balance in total');
  const off = validateEntry([{ debit: 500 }, { credit: 499 }]); assert.equal(off.ok, false); assert.match(off.errors[0], /out of balance by 0\.01/);
  assert.match(validateEntry([{ debit: 100, credit: 100 }, { credit: 0, debit: 0 }]).errors.join(), /both.*neither|Line 1.*both/s); assert.match(validateEntry([{ debit: 0 }, { credit: 5 }]).errors[0], /Line 1.*neither/);
  assert.match(validateEntry([{ debit: 100 }]).errors[0], /at least two lines/); assert.equal(validateEntry('x').ok, false); assert.match(validateEntry([{ debit: -5 }, { credit: -5 }]).errors[0], /non-negative/); assert.match(validateEntry([{ debit: 1.5 }, { credit: 1.5 }]).errors[0], /whole cents/);
});
test('balanceOf: natural signs', () => { assert.equal(balanceOf('asset', 1000, 300), 700); assert.equal(balanceOf('expense', 50, 0), 50); assert.equal(balanceOf('liability', 100, 600), 500); assert.equal(balanceOf('income', 0, 900), 900); assert.equal(balanceOf('asset', 100, 300), -200, 'overdrawn asset is negative'); });
const A = (type, debit, credit, name = type) => ({ id: name, code: name, name, type, debit, credit });
test('trialBalance: columns, contra balances and totals', () => {
  const tb = trialBalance([A('asset', 1000, 0, 'cash'), A('equity', 0, 1000, 'capital'), A('asset', 0, 0, 'unused')]); assert.equal(tb.rows.length, 2, 'zero-activity accounts omitted'); assert.deepEqual([tb.debit, tb.credit, tb.balanced], [1000, 1000, true]);
  const over = trialBalance([A('asset', 100, 300, 'overdrawn'), A('liability', 200, 0, 'prepaid'), A('income', 0, 100, 'sales')]); const od = over.rows.find((r) => r.name === 'overdrawn'); assert.deepEqual([od.debitCol, od.creditCol], [0, 200], 'negative asset shows in the credit column'); const pp = over.rows.find((r) => r.name === 'prepaid'); assert.deepEqual([pp.debitCol, pp.creditCol], [200, 0], 'debit-balance liability shows as debit');
});
test('statements: accounting equation with net income', () => {
  // owner invests 10000, buys supplies 2000 cash, earns 5000 on credit-free sale, pays 1500 rent
  const accts = [A('asset', 10000 + 5000, 2000 + 1500, 'cash'), A('asset', 2000, 0, 'supplies'), A('equity', 0, 10000, 'capital'), A('income', 0, 5000, 'sales'), A('expense', 1500, 0, 'rent')];
  const s = statements(accts); assert.deepEqual(s, { income: 5000, expense: 1500, netIncome: 3500, assets: 13500, liabilities: 0, equity: 10000, equityWithEarnings: 13500, balanced: true });
});
