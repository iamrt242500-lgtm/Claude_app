import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, acc = {};
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
before(async () => { server = createApp({ now: () => new Date('2026-03-31T12:00:00Z') }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; for (const a of await J('GET', '/accounts')) acc[a.name] = a.id; });
after(() => server.close());
const post = (day, memo, ...lines) => call('POST', '/entries', { day, memo, lines: lines.map(([account, debit, credit]) => ({ account: acc[account], debit, credit })) });

test('default chart of accounts is seeded', () => { assert.ok(Object.keys(acc).length >= 8); assert.ok(acc.Cash && acc.Sales && acc.Rent && acc['Owner’s Equity']); });
test('entries must balance, have two sides per line and valid accounts; amounts are text', async () => {
  const ok = await post('2026-03-01', 'Owner invests', ['Cash', '10000', ''], ['Owner’s Equity', '', '10,000.00']); assert.equal(ok.status, 201); const e = await ok.json(); assert.deepEqual(e.lines.map((l) => [l.name, l.debit, l.credit]), [['Cash', 1000000, 0], ['Owner’s Equity', 0, 1000000]]);
  const cases = [[['Cash', '100', ''], ['Sales', '', '99.99']], [['Cash', '100', '100'], ['Sales', '', '0']], [['Cash', '100', '']], [['Cash', 'abc', ''], ['Sales', '', '1']], [['Cash', 100, ''], ['Sales', '', 100]]];
  for (const lines of cases) { const r = await post('2026-03-02', 'bad', ...lines); assert.equal(r.status, 422, JSON.stringify(lines)); assert.ok((await r.json()).details.lines); }
  const noAcc = await call('POST', '/entries', { day: '2026-03-02', memo: 'x', lines: [{ account: 9999, debit: '1' }, { account: acc.Cash, credit: '1' }] }); assert.equal(noAcc.status, 422);
  const meta = await call('POST', '/entries', { day: '2026-02-30', memo: '', lines: [] }); assert.deepEqual(Object.keys((await meta.json()).details).sort(), ['day', 'lines', 'memo']);
});
test('a failed entry leaves no partial data', async () => {
  const before = (await J('GET', '/entries')).length; await post('2026-03-02', 'unbalanced', ['Cash', '5', ''], ['Sales', '', '4']); assert.equal((await J('GET', '/entries')).length, before);
});
test('balances use natural signs; reports balance (trial balance, income statement, balance sheet)', async () => {
  await post('2026-03-05', 'Buy equipment', ['Equipment', '2000', ''], ['Cash', '', '2000']); await post('2026-03-10', 'Cash sale', ['Cash', '5000', ''], ['Sales', '', '5000']); await post('2026-03-15', 'March rent', ['Rent', '1500', ''], ['Cash', '', '1500']); await post('2026-03-20', 'Supplies on credit', ['Supplies', '300', ''], ['Accounts Payable', '', '300']); await post('2026-04-02', 'April sale', ['Cash', '700', ''], ['Sales', '', '700']);
  const list = Object.fromEntries((await J('GET', '/accounts')).map((a) => [a.name, a.balance]));
  assert.equal(list.Cash, 1000000 - 200000 + 500000 - 150000 + 70000); assert.equal(list.Sales, 570000); assert.equal(list.Rent, 150000); assert.equal(list['Accounts Payable'], 30000);
  const tb = await J('GET', '/reports/trial-balance?to=2026-03-31'); assert.equal(tb.balanced, true); assert.equal(tb.debit, tb.credit); assert.ok(!tb.rows.some((r) => r.name === 'Wages'), 'inactive accounts omitted'); assert.equal(tb.rows.find((r) => r.name === 'Cash').debit, 1000000 - 200000 + 500000 - 150000);
  const st = await J('GET', '/reports/statements?from=2026-03-01&to=2026-03-31'); assert.equal(st.incomeStatement.totalIncome, 500000); assert.equal(st.incomeStatement.totalExpenses, 150000 + 30000); assert.equal(st.incomeStatement.netIncome, 320000);
  assert.equal(st.balanceSheet.balanced, true); assert.equal(st.balanceSheet.totalAssets, 200000 + 1000000 - 200000 + 500000 - 150000); assert.equal(st.balanceSheet.totalLiabilitiesAndEquity, st.balanceSheet.totalAssets); assert.equal(st.balanceSheet.retainedEarnings, 320000);
  const apr = await J('GET', '/reports/statements?from=2026-04-01&to=2026-04-30'); assert.equal(apr.incomeStatement.netIncome, 70000); assert.equal(apr.balanceSheet.retainedEarnings, 390000, 'balance sheet is cumulative');
  assert.equal((await call('GET', '/reports/trial-balance?to=2026-02-30')).status, 400); assert.equal((await call('GET', '/reports/statements?from=2026-05-01&to=2026-04-01')).status, 422);
});
test('account ledger shows running balance', async () => {
  const l = await J('GET', `/accounts/${acc.Cash}/ledger`); assert.deepEqual(l.rows.map((r) => r.balance), [1000000, 800000, 1300000, 1150000, 1220000]); assert.equal(l.account.name, 'Cash');
});
test('void creates a reversing entry, links both ways, restores balances, cannot repeat or void the reversal', async () => {
  const e = await (await post('2026-03-25', 'Mistaken sale', ['Cash', '123.45', ''], ['Sales', '', '123.45'])).json(); const before = (await J('GET', '/accounts')).find((a) => a.name === 'Sales').balance;
  const v = await call('POST', `/entries/${e.id}/void`, {}); assert.equal(v.status, 200); const r = await v.json(); assert.equal(r.reversalOf, e.id); assert.equal(r.day, '2026-03-31'); assert.deepEqual(r.lines.map((l) => [l.debit, l.credit]), [[0, 12345], [12345, 0]]);
  assert.equal((await J('GET', `/entries/${e.id}`)).voidedBy, r.id); assert.equal((await J('GET', '/accounts')).find((a) => a.name === 'Sales').balance, before - 12345);
  assert.equal((await call('POST', `/entries/${e.id}/void`, {})).status, 409); assert.equal((await call('POST', `/entries/${r.id}/void`, {})).status, 409); assert.equal((await J('GET', '/reports/trial-balance')).balanced, true);
});
test('entries filter by account and date range', async () => {
  const rent = await J('GET', `/entries?account=${acc.Rent}`); assert.deepEqual(rent.map((e) => e.memo), ['March rent']); assert.deepEqual((await J('GET', '/entries?from=2026-04-01')).map((e) => e.memo), ['April sale']); assert.equal((await call('GET', '/entries?from=nope')).status, 400);
});
test('accounts: create, validation, rename, archive blocks posting, delete only when unused, type locked once used', async () => {
  const a = await call('POST', '/accounts', { code: '5300', name: 'Software', type: 'expense' }); assert.equal(a.status, 201); const id = (await a.json()).id;
  for (const [b, k] of [[{ code: '5300', name: 'x', type: 'expense' }, 'code'], [{ code: '!', name: 'x', type: 'expense' }, 'code'], [{ code: '5301', name: '', type: 'expense' }, 'name'], [{ code: '5301', name: 'x', type: 'revenue' }, 'type']]) { const r = await call('POST', '/accounts', b); assert.equal(r.status, 422); assert.ok((await r.json()).details[k], k); }
  assert.equal((await J('PATCH', `/accounts/${id}`, { name: 'SaaS tools' })).name, 'SaaS tools'); assert.equal((await J('PATCH', `/accounts/${id}`, { type: 'asset' })).type, 'asset', 'unused → type may change'); await J('PATCH', `/accounts/${id}`, { type: 'expense' });
  await J('PATCH', `/accounts/${id}`, { archived: true }); const r = await call('POST', '/entries', { day: '2026-03-30', memo: 'x', lines: [{ account: id, debit: '5' }, { account: acc.Cash, credit: '5' }] }); assert.equal(r.status, 422); assert.match((await r.json()).details.lines, /archived/);
  assert.equal((await call('DELETE', `/accounts/${id}`)).status, 204); assert.equal((await call('DELETE', `/accounts/${acc.Cash}`)).status, 409); assert.equal((await call('PATCH', `/accounts/${acc.Cash}`, { type: 'expense' })).status, 422);
});
test('errors and static', async () => {
  assert.equal((await fetch(base + '/api/entries', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.match(await (await fetch(base + '/ledger.js')).text(), /export function validateEntry/); assert.equal((await call('GET', '/entries/999')).status, 404);
});
