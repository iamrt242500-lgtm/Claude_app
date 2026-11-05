import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
before(async () => { server = createApp({ now: () => new Date('2026-03-31T12:00:00Z') }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const mv = (id, type, qty, day, unitCost, extra = {}) => call('POST', `/items/${id}/movements`, { type, qty, day, unitCost, ...extra });

test('items: create, uppercase SKU, uniqueness, validation, patch, delete rules', async () => {
  const a = await call('POST', '/items', { sku: ' widget-1 ', name: 'Widget', unit: 'pcs', reorderPoint: 10 }); assert.equal(a.status, 201); const w = await a.json(); assert.equal(w.sku, 'WIDGET-1'); assert.equal(w.onHand, 0); assert.equal(w.low, true, 'zero stock is below a reorder point of 10');
  assert.equal((await call('POST', '/items', { sku: 'widget-1', name: 'Dup' })).status, 422);
  for (const [b, k] of [[{ sku: '!', name: 'x' }, 'sku'], [{ sku: 'A', name: '' }, 'name'], [{ sku: 'A', name: 'x', reorderPoint: -1 }, 'reorderPoint'], [{ sku: 'A', name: 'x', unit: 'x'.repeat(13) }, 'unit'], [{ sku: 'A', name: 'x', reorderPoint: 1.5 }, 'reorderPoint']]) { const r = await call('POST', '/items', b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[k], k); }
  const p = await J('PATCH', `/items/${w.id}`, { name: 'Widget XL', reorderPoint: 5 }); assert.equal(p.name, 'Widget XL'); assert.equal(p.reorderPoint, 5); assert.equal((await call('PATCH', `/items/${w.id}`, { archived: 'yes' })).status, 422);
  const t = await J('POST', '/items', { sku: 'TMP', name: 'Temp' }); assert.equal((await call('DELETE', `/items/${t.id}`)).status, 204); await mv(w.id, 'receive', 1, '2026-03-01', '1'); assert.equal((await call('DELETE', `/items/${w.id}`)).status, 409);
});
test('FIFO costing end to end: lots, cost of each issue, running balance, value', async () => {
  const it = await J('POST', '/items', { sku: 'BOLT', name: 'Bolt', reorderPoint: 20 }); assert.equal((await mv(it.id, 'receive', 100, '2026-03-01', '0.10')).status, 201); await mv(it.id, 'receive', 100, '2026-03-10', '0.12');
  const d = await (await mv(it.id, 'issue', 130, '2026-03-15', undefined)).json(); assert.equal(d.onHand, 70); assert.equal(d.value, 70 * 12); assert.deepEqual(d.lots, [{ qty: 70, cost: 12, day: '2026-03-10', id: d.lots[0].id }]);
  const issue = d.movements[0]; assert.equal(issue.type, 'issue'); assert.equal(issue.cost, 100 * 10 + 30 * 12); assert.equal(issue.balance, 70); assert.equal(d.low, false);
  const r = await (await mv(it.id, 'issue', 55, '2026-03-20')).json(); assert.equal(r.onHand, 15); assert.equal(r.low, true); assert.equal(r.daysOfCover, Math.floor(15 / ((130 + 55) / 30)));
});
test('stock can never go negative — including via backdating or deleting a receipt', async () => {
  const it = await J('POST', '/items', { sku: 'NUT', name: 'Nut' }); await mv(it.id, 'receive', 10, '2026-03-10', '0.05');
  const over = await mv(it.id, 'issue', 11, '2026-03-20'); assert.equal(over.status, 409); assert.match((await over.json()).error, /Only 10 on hand/);
  const early = await mv(it.id, 'issue', 1, '2026-03-05'); assert.equal(early.status, 409, 'nothing was in stock yet on 03-05'); assert.match((await early.json()).error, /Only 0 on hand on 2026-03-05/);
  const d = await (await mv(it.id, 'issue', 4, '2026-03-12')).json(); const receipt = d.movements.find((m) => m.type === 'receive'); const del = await call('DELETE', `/movements/${receipt.id}`); assert.equal(del.status, 409); assert.match((await del.json()).error, /Can’t remove this/);
  const issue = d.movements.find((m) => m.type === 'issue'); const ok = await call('DELETE', `/movements/${issue.id}`); assert.equal(ok.status, 200); assert.equal((await ok.json()).onHand, 10);
  const back = await mv(it.id, 'receive', 5, '2026-03-01', '0.20'); assert.equal(back.status, 201, 'backdated receipts are fine'); const dd = await J('GET', `/items/${it.id}`); assert.equal(dd.onHand, 15);
});
test('adjustments: positive needs a cost, negative is shrinkage at FIFO cost; validation of every field', async () => {
  const it = await J('POST', '/items', { sku: 'GEAR', name: 'Gear' }); await mv(it.id, 'receive', 10, '2026-03-01', '5');
  assert.equal((await mv(it.id, 'adjust', 2, '2026-03-02')).status, 422); assert.equal((await mv(it.id, 'adjust', 2, '2026-03-02', '6')).status, 201); const s = await (await mv(it.id, 'adjust', -3, '2026-03-03', undefined, { note: 'recount' })).json(); assert.equal(s.onHand, 9); assert.equal(s.movements[0].cost, 1500);
  for (const [b, k] of [[{ type: 'x', qty: 1 }, 'type'], [{ type: 'issue', qty: -1 }, 'qty'], [{ type: 'issue', qty: 0 }, 'qty'], [{ type: 'issue', qty: 1.5 }, 'qty'], [{ type: 'receive', qty: 1, unitCost: 5 }, 'unitCost'], [{ type: 'issue', qty: 1, unitCost: '2' }, 'unitCost'], [{ type: 'issue', qty: 1, day: '2026-04-01' }, 'day'], [{ type: 'issue', qty: 1, day: '2026-02-30' }, 'day'], [{ type: 'issue', qty: 1, note: 'x'.repeat(121) }, 'note']]) { const r = await call('POST', `/items/${it.id}/movements`, b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[k], k); }
  await J('PATCH', `/items/${it.id}`, { archived: true }); assert.equal((await mv(it.id, 'receive', 1, '2026-03-04', '1')).status, 409);
});
test('reports: valuation as of a date, COGS vs shrinkage for a period, low-stock ordering', async () => {
  const v = await J('GET', '/reports/valuation?asOf=2026-03-14'); const bolt = v.rows.find((r) => r.sku === 'BOLT'); assert.equal(bolt.onHand, 200); assert.equal(bolt.value, 100 * 10 + 100 * 12); assert.equal(bolt.avgCost, 11); assert.equal(v.total, v.rows.reduce((s, r) => s + r.value, 0));
  const later = await J('GET', '/reports/valuation'); assert.equal(later.rows.find((r) => r.sku === 'BOLT').onHand, 15);
  const c = await J('GET', '/reports/cogs?from=2026-03-01&to=2026-03-31'); const gear = c.rows.find((r) => r.sku === 'GEAR'); assert.deepEqual([gear.cogs, gear.shrinkage], [0, 1500]); const bolt2 = c.rows.find((r) => r.sku === 'BOLT'); assert.equal(bolt2.cogs, 1360 + 55 * 12);
  assert.equal((await J('GET', '/reports/cogs?from=2026-03-16&to=2026-03-31')).rows.find((r) => r.sku === 'BOLT').cogs, 55 * 12); assert.equal((await call('GET', '/reports/cogs?from=2026-04-01&to=2026-03-01')).status, 422); assert.equal((await call('GET', '/reports/valuation?asOf=nope')).status, 400);
  const low = await J('GET', '/reports/low-stock'); assert.ok(low.length >= 1 && low.every((x) => x.low)); assert.equal(low[0].sku, 'BOLT');
});
test('errors and static', async () => {
  assert.equal((await call('GET', '/items/999')).status, 404); assert.equal((await call('GET', '/items/zz')).status, 400); assert.equal((await call('DELETE', '/movements/999')).status, 404); assert.equal((await fetch(base + '/api/items', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.match(await (await fetch(base + '/inventory.js')).text(), /export function replay/);
});
