import test from 'node:test';
import assert from 'node:assert/strict';
import { toCents, totals, lineTotal, formatMoney, validateInvoice } from '../src/money.js';

test('toCents parses safely', () => {
  assert.equal(toCents('12.5'), 1250); assert.equal(toCents('1,200.99'), 120099); assert.equal(toCents(0), 0); assert.equal(toCents('7'), 700); assert.equal(toCents('0.07'), 7);
  for (const bad of ['', '-1', '1.234', 'abc', '1e3', null, '12.']) assert.equal(toCents(bad), null, String(bad));
});
test('classic float trap: 0.1+0.2 style amounts stay exact in cents', () => {
  const t = totals([{ qty: 3, unitCents: toCents('0.10') }, { qty: 3, unitCents: toCents('0.20') }], 0);
  assert.equal(t.total, 90);
});
test('totals: rounding of fractional quantities and tax', () => {
  assert.equal(lineTotal(1.5, 333), 500);            // 499.5 -> 500
  const t = totals([{ qty: 2, unitCents: 1999 }], 825);   // 8.25% on $39.98
  assert.deepEqual(t, { subtotal: 3998, tax: 330, total: 4328 });
  assert.deepEqual(totals([], 1000), { subtotal: 0, tax: 0, total: 0 });
});
test('formatMoney', () => { assert.equal(formatMoney(123456, 'USD'), '$1,234.56'); assert.match(formatMoney(5, 'EUR'), /0\.05/); });
test('validateInvoice', () => {
  const ok = { clientId: 1, issueDate: '2026-01-01', dueDate: '2026-01-31', currency: 'USD', taxPercent: 8.25, items: [{ description: 'Work', qty: 2, unitPrice: '10.50' }] };
  const r = validateInvoice(ok); assert.equal(r.value.taxBp, 825); assert.equal(r.value.items[0].unitCents, 1050);
  assert.ok(validateInvoice({ ...ok, dueDate: '2025-12-31' }).errors.dueDate); assert.ok(validateInvoice({ ...ok, dueDate: '2026-02-30' }).errors.dueDate, 'impossible dates rejected'); assert.ok(validateInvoice({ ...ok, issueDate: '2026-13-01' }).errors.issueDate);
  assert.ok(validateInvoice({ ...ok, items: [] }).errors.items);
  assert.match(validateInvoice({ ...ok, items: [{ description: 'x', qty: 0, unitPrice: '1' }] }).errors.items, /Line 1: quantity/);
  assert.match(validateInvoice({ ...ok, items: [{ description: 'x', qty: 1, unitPrice: 'free' }] }).errors.items, /unit price/);
  assert.ok(validateInvoice({ ...ok, taxPercent: 101 }).errors.taxPercent); assert.ok(validateInvoice({ ...ok, currency: 'JPY' }).errors.currency);
  assert.ok(validateInvoice(null).errors.clientId);
});
