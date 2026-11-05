import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const stroke = (o = {}) => ({ tool: 'pen', color: '#ff0000', size: 4, points: [[10, 10], [50, 60], [90, 20]], ...o });

test('CRUD with normalization; list shows stroke counts; autosave PUT replaces strokes', async () => {
  assert.equal((await call('POST', '/drawings', { title: '', strokes: [] })).status, 422);
  const d = await (await call('POST', '/drawings', { title: ' Cat ', strokes: [stroke({ color: '#FF0000', points: [[-3, 999.99]] })] })).json(); assert.equal(d.title, 'Cat'); assert.deepEqual(d.strokes[0].points, [[0, 600]]); assert.equal(d.strokes[0].color, '#ff0000');
  const up = await (await call('PUT', `/drawings/${d.id}`, { title: 'Cat 2', strokes: [stroke(), stroke({ tool: 'eraser' })] })).json(); assert.equal(up.strokes.length, 2);
  const list = await (await call('GET', '/drawings')).json(); assert.equal(list[0].strokeCount, 2); assert.equal(list[0].title, 'Cat 2'); assert.equal(list[0].strokes, undefined, 'list is lightweight');
  assert.equal((await call('DELETE', `/drawings/${d.id}`)).status, 204); assert.equal((await call('GET', `/drawings/${d.id}`)).status, 404);
});
test('validation errors are 422 with a message and never store bad data', async () => {
  const before = (await (await call('GET', '/drawings')).json()).length;
  for (const b of [{ title: 'x', strokes: [stroke({ color: '"><script>' })] }, { title: 'x', strokes: [stroke({ tool: 'x' })] }, { title: 'x', strokes: [stroke({ points: [[1, 'a']] })] }, { title: 'x', strokes: 'nope' }]) { const r = await call('POST', '/drawings', b); assert.equal(r.status, 422); assert.ok((await r.json()).details.strokes); }
  assert.equal((await (await call('GET', '/drawings')).json()).length, before);
  assert.equal((await call('POST', '/drawings', { title: 'x', strokes: Array(2001).fill(stroke()) })).status, 422); assert.equal((await fetch(base + '/api/drawings', { method: 'POST', body: '{x' })).status, 400);
  const huge = await fetch(base + '/api/drawings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x', strokes: [], pad: 'a'.repeat(9_000_000) }) }); assert.equal(huge.status, 413);
});
test('SVG endpoint: valid image/svg+xml, locked-down CSP, download header, eraser painted as background', async () => {
  const d = await (await call('POST', '/drawings', { title: 'My: Cool/Drawing!', strokes: [stroke({ color: '#0000ff' }), stroke({ tool: 'eraser', color: '#00ff00' }), stroke({ points: [[100, 100]], size: 20 })] })).json();
  const r = await fetch(base + `/api/drawings/${d.id}/svg`); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /^image\/svg\+xml/); assert.match(r.headers.get('content-security-policy'), /default-src 'none'/); assert.equal(r.headers.get('content-disposition'), 'inline');
  const svg = await r.text(); assert.match(svg, /^<svg /); assert.match(svg, /stroke="#0000ff"/); assert.match(svg, /stroke="#ffffff"/); assert.ok(!svg.includes('#00ff00')); assert.match(svg, /<circle cx="100" cy="100" r="10"/);
  const dl = await fetch(base + `/api/drawings/${d.id}/svg?download=1`); assert.equal(dl.headers.get('content-disposition'), 'attachment; filename="My_Cool_Drawing.svg"');
});
test('shared module is served to the browser; errors and static', async () => {
  const m = await fetch(base + '/draw.js'); assert.equal(m.status, 200); assert.match(m.headers.get('content-type'), /javascript/); assert.match(await m.text(), /export function simplify/);
  assert.equal((await call('GET', '/drawings/abc')).status, 400); assert.equal((await call('GET', '/drawings/9999/svg')).status, 404); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.equal((await fetch(base + '/')).status, 200);
});
