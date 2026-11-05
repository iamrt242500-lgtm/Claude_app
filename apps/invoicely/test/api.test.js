import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, day = '2026-03-10';
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ today: () => day }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const inv = (clientId, over = {}) => ({ clientId, issueDate: '2026-03-01', dueDate: '2026-03-15', currency: 'USD', taxPercent: 10, notes: 'Thanks', items: [{ description: 'Design', qty: 10, unitPrice: '50.00' }, { description: 'Hosting', qty: 1, unitPrice: '19.99' }], ...over });

test('client validation + CRUD + delete protection', async () => {
  assert.equal((await call('POST', '/clients', { name: '' })).status, 422);
  assert.equal((await call('POST', '/clients', { name: 'A', email: 'bad' })).status, 422);
  const c = await (await call('POST', '/clients', { name: 'Acme', email: 'a@acme.io', address: '1 Main St' })).json();
  assert.equal((await (await call('PUT', `/clients/${c.id}`, { name: 'Acme Inc' })).json()).name, 'Acme Inc');
  const i = await (await call('POST', '/invoices', inv(c.id))).json();
  assert.equal((await call('DELETE', `/clients/${c.id}`)).status, 409);
  assert.equal((await (await call('GET', '/clients')).json())[0].invoices, 1);
  await call('DELETE', `/invoices/${i.id}`); assert.equal((await call('DELETE', `/clients/${c.id}`)).status, 204);
});
test('invoice lifecycle: numbering, totals, status rules, edit lock, overdue, summary', async () => {
  const c = await (await call('POST', '/clients', { name: 'Beta' })).json();
  const a = await (await call('POST', '/invoices', inv(c.id))).json();
  assert.match(a.number, /^INV-\d{4}$/); assert.equal(a.subtotal, 51999); assert.equal(a.tax, 5200); assert.equal(a.total, 57199); assert.equal(a.status, 'draft');
  const b = await (await call('POST', '/invoices', inv(c.id, { items: [{ description: 'X', qty: 1, unitPrice: '100' }], taxPercent: 0 }))).json();
  assert.notEqual(a.number, b.number);
  assert.equal((await call('POST', `/invoices/${a.id}/status`, { status: 'paid' })).status, 409, 'draft cannot jump to paid');
  assert.equal((await (await call('POST', `/invoices/${a.id}/status`, { status: 'sent' })).json()).status, 'sent');
  assert.equal((await call('PUT', `/invoices/${a.id}`, inv(c.id))).status, 409, 'sent invoice is locked');
  assert.equal((await call('DELETE', `/invoices/${a.id}`)).status, 409);
  let list = await (await call('GET', '/invoices?status=overdue')).json(); assert.equal(list.length, 0);
  day = '2026-03-20';
  list = await (await call('GET', '/invoices?status=overdue')).json(); assert.equal(list.length, 1); assert.equal(list[0].overdue, true);
  let s = await (await call('GET', '/summary')).json(); assert.equal(s.counts.overdue, 1); assert.equal(s.currencies[0].overdue, 57199);
  const paid = await (await call('POST', `/invoices/${a.id}/status`, { status: 'paid' })).json(); assert.equal(paid.paidAt, '2026-03-20'); assert.equal(paid.overdue, false);
  s = await (await call('GET', '/summary')).json(); assert.equal(s.currencies[0].paidThisYear, 57199); assert.equal(s.currencies[0].outstanding, 0);
  assert.deepEqual(s.revenueByMonth, [{ currency: 'USD', month: '2026-03', total: 57199 }]);
  await call('POST', `/invoices/${a.id}/status`, { status: 'sent' });
  await call('POST', `/invoices/${a.id}/status`, { status: 'draft' });
  const edited = await (await call('PUT', `/invoices/${a.id}`, inv(c.id, { items: [{ description: 'Only', qty: 2.5, unitPrice: '10' }], taxPercent: 20 }))).json();
  assert.equal(edited.total, 3000); assert.equal(edited.items.length, 1);
  assert.equal((await call('DELETE', `/invoices/${a.id}`)).status, 204);
});
test('invoice validation errors and not found', async () => {
  const c = await (await call('POST', '/clients', { name: 'Gamma' })).json();
  const bad = await call('POST', '/invoices', inv(c.id, { dueDate: '2026-02-01', items: [] })); assert.equal(bad.status, 422);
  const d = (await bad.json()).details; assert.ok(d.dueDate && d.items);
  assert.equal((await call('POST', '/invoices', inv(9999))).status, 404);
  assert.equal((await call('GET', '/invoices/999')).status, 404); assert.equal((await call('GET', '/invoices/x')).status, 400);
  assert.equal((await fetch(base + '/api/invoices', { method: 'POST', body: '{x' })).status, 400);
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
