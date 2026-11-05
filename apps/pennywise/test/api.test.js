import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ now: () => new Date('2026-03-15T12:00:00Z') }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const addCat = async (name, budget) => (await call('POST', '/categories', { name, budget })).json();
const addTx = async (b) => (await call('POST', '/transactions', b)).json();

test('categories: validation, uniqueness, budget parsing, delete keeps transactions uncategorized', async () => {
  for (const [b, key] of [[{ name: '' }, 'name'], [{ name: 'x', budget: '-5' }, 'budget'], [{ name: 'x', budget: 'abc' }, 'budget'], [{ name: 'x'.repeat(41) }, 'name']]) { const r = await call('POST', '/categories', b); assert.equal(r.status, 422); assert.ok((await r.json()).details[key], key); }
  const food = await addCat('Food', '$500.00'); assert.equal(food.budget, 50000); assert.equal((await call('POST', '/categories', { name: 'food' })).status, 422, 'case-insensitive unique');
  const t = await addTx({ type: 'expense', amount: '12.34', day: '2026-03-02', categoryId: food.id, note: 'Lunch' }); assert.equal(t.categoryName, 'Food');
  assert.equal((await call('PUT', `/categories/${food.id}`, { name: 'Groceries', budget: '' })).status, 200);
  assert.equal((await call('DELETE', `/categories/${food.id}`)).status, 204); assert.equal((await (await call('GET', `/transactions/${t.id}`)).json()).categoryId, null);
});
test('transactions: CRUD, validation, filters and LIKE-escaping search', async () => {
  const c = await addCat('Fun', '100');
  for (const [b, key] of [[{ type: 'x', amount: '5', day: '2026-03-01' }, 'type'], [{ type: 'expense', amount: '0', day: '2026-03-01' }, 'amount'], [{ type: 'expense', amount: '(5)', day: '2026-03-01' }, 'amount'], [{ type: 'expense', amount: '-5', day: '2026-03-01' }, 'amount'], [{ type: 'expense', amount: '1.234', day: '2026-03-01' }, 'amount'], [{ type: 'expense', amount: '5', day: '2026-02-30' }, 'day'], [{ type: 'expense', amount: '5', day: '2026-13-01' }, 'day'], [{ type: 'expense', amount: '5', day: '2026-03-01', categoryId: 9999 }, 'categoryId'], [{ type: 'expense', amount: '5', day: '2026-03-01', note: 'x'.repeat(201) }, 'note']]) {
    const r = await call('POST', '/transactions', b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[key], key);
  }
  const a = await addTx({ type: 'expense', amount: '7.50', day: '2026-03-03', categoryId: c.id, note: '100% cotton' }); assert.equal(a.amount, 750);
  await addTx({ type: 'income', amount: '1,000', day: '2026-02-01', note: 'Feb pay' });
  assert.equal((await (await call('GET', '/transactions?month=2026-03')).json()).filter((x) => x.note === '100% cotton').length, 1); assert.equal((await (await call('GET', '/transactions?month=2026-02&type=income')).json()).length, 1);
  assert.equal((await (await call('GET', '/transactions?q=' + encodeURIComponent('100%'))).json()).length, 1); assert.equal((await (await call('GET', '/transactions?q=' + encodeURIComponent('%'))).json()).length, 1, 'literal %, not a wildcard');
  assert.equal((await (await call('GET', `/transactions?categoryId=${c.id}`)).json()).length, 1); assert.equal((await call('GET', '/transactions?month=2026-3')).status, 422);
  const up = await (await call('PUT', `/transactions/${a.id}`, { type: 'expense', amount: '9', day: '2026-03-04', note: 'edited' })).json(); assert.equal(up.amount, 900); assert.equal(up.categoryId, null);
  assert.equal((await call('DELETE', `/transactions/${a.id}`)).status, 204); assert.equal((await call('GET', `/transactions/${a.id}`)).status, 404);
});
test('summary: monthly totals, budget status, 6-month trend, default month from the clock', async () => {
  const rent = await addCat('Rent', '1000'), eat = await addCat('Eating out', '100');
  await addTx({ type: 'income', amount: '3000', day: '2026-03-01', note: 'Salary' }); await addTx({ type: 'expense', amount: '1000', day: '2026-03-01', categoryId: rent.id }); await addTx({ type: 'expense', amount: '85', day: '2026-03-09', categoryId: eat.id }); await addTx({ type: 'expense', amount: '30', day: '2026-03-10', categoryId: eat.id });
  const s = await (await call('GET', '/summary')).json(); assert.equal(s.month, '2026-03'); assert.equal(s.current, '2026-03');
  const byName = Object.fromEntries(s.categories.map((c) => [c.name, c])); assert.equal(byName['Rent'].status, 'warn'); assert.equal(byName['Eating out'].status, 'over'); assert.equal(byName['Eating out'].spent, 11500); assert.equal(byName['Eating out'].remaining, -1500);
  assert.equal(s.trend.length, 6); assert.equal(s.trend.at(-1).month, '2026-03'); assert.equal(s.trend[0].month, '2025-10'); assert.equal((await (await call('GET', '/summary?month=2026-02')).json()).income, 100000);
  assert.equal((await call('GET', '/summary?month=bad')).status, 422);
});
test('CSV import: dry run preview, duplicate detection, invalid lines, date order, categories auto-created, export round-trip', async () => {
  const csv = 'Date,Description,Amount,Category\n03/20/2026,Coffee,-4.50,Cafe\n03/20/2026,Coffee,-4.50,Cafe\n03/21/2026,Paycheck,2000.00,\n13/45/2026,Bad,-1,\n03/22/2026,Oops,abc,';
  const dry = await (await call('POST', '/import', { csv, dateOrder: 'mdy' })).json(); assert.equal(dry.dryRun, true); assert.equal(dry.valid, 3); assert.equal(dry.duplicates, 1, 'in-file duplicate'); assert.equal(dry.toImport, 2); assert.equal(dry.errorCount, 2); assert.equal(dry.errors[0].line, 5);
  const before = (await (await call('GET', '/transactions')).json()).length;
  assert.equal((await (await call('POST', '/import', { csv, dateOrder: 'mdy', dryRun: false })).json()).details.csv.includes('2 invalid'), true, 'refuses without skipInvalid');
  assert.equal((await (await call('GET', '/transactions')).json()).length, before, 'nothing written on refusal');
  const done = await call('POST', '/import', { csv, dateOrder: 'mdy', dryRun: false, skipInvalid: true }); assert.equal(done.status, 201); assert.equal((await done.json()).imported, 2);
  assert.ok((await (await call('GET', '/categories')).json()).some((c) => c.name === 'Cafe'));
  const again = await (await call('POST', '/import', { csv, dateOrder: 'mdy' })).json(); assert.equal(again.toImport, 0, 're-importing the same file adds nothing'); assert.equal(again.duplicates, 3);
  assert.equal((await call('POST', '/import', { csv: '', dateOrder: 'mdy' })).status, 422); assert.equal((await call('POST', '/import', { csv, dateOrder: 'xyz' })).status, 422);
  const exp = await fetch(base + '/api/export'); assert.match(exp.headers.get('content-type'), /text\/csv/); const text = await exp.text(); assert.match(text, /^date,description,amount,category/); assert.match(text, /2026-03-20,"Coffee",-4.50,"Cafe"/);
});
test('export neutralizes formula injection; errors; static', async () => {
  await addTx({ type: 'expense', amount: '1', day: '2026-03-05', note: '=HYPERLINK("http://x")' }); assert.match(await (await fetch(base + '/api/export')).text(), /"'=HYPERLINK\(""http:\/\/x""\)"/);
  assert.equal((await call('GET', '/transactions/abc')).status, 400); assert.equal((await call('GET', '/categories/9999/x')).status, 404); assert.equal((await fetch(base + '/api/transactions', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
