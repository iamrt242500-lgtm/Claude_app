import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { parseColor, contrast } from '../src/color.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test('check: passing pair has no suggestions; truncated ratio; normalised hex', async () => {
  const r = await (await call('POST', '/check', { fg: '#000', bg: 'white' })).json(); assert.deepEqual({ ratio: r.ratio, level: r.level, fg: r.fg, bg: r.bg, suggestions: r.suggestions }, { ratio: 21, level: 'AAA', fg: '#000000', bg: '#ffffff', suggestions: {} });
  const b = await (await call('POST', '/check', { fg: '#767676', bg: '#fff' })).json(); assert.equal(b.ratio, 4.54); assert.equal(b.level, 'AA'); assert.equal(b.aaNormal, true); assert.equal(b.aaaNormal, false); assert.ok(b.suggestions.aaa.ratio >= 7);
});
test('check: failing pair suggests a fix that really passes, in the same hue family', async () => {
  const r = await (await call('POST', '/check', { fg: '#777', bg: '#fff' })).json(); assert.equal(r.level, 'AA Large'); assert.equal(r.aaNormal, false); assert.equal(r.suggestions.aa.color, '#767676'); assert.ok(contrast(parseColor(r.suggestions.aa.color), parseColor('#fff')) >= 4.5);
  const y = await (await call('POST', '/check', { fg: '#ffcc00', bg: '#ffffff' })).json(); assert.equal(y.level, 'Fail'); assert.ok(contrast(parseColor(y.suggestions.aa.color), parseColor('#fff')) >= 4.5); assert.ok(contrast(parseColor(y.suggestions.aaa.color), parseColor('#fff')) >= 7);
  const imp = await (await call('POST', '/check', { fg: '#888', bg: '#777777' })).json(); assert.equal(imp.suggestions.aaa, null, 'impossible target → null, not a lie');
});
test('check: validation reports both bad inputs', async () => {
  const r = await call('POST', '/check', { fg: 'nope', bg: 42 }); assert.equal(r.status, 422); assert.deepEqual(Object.keys((await r.json()).details).sort(), ['bg', 'fg']); assert.equal((await call('POST', '/check', {})).status, 422);
});
test('palettes: CRUD with normalisation and validation', async () => {
  const p = await (await call('POST', '/palettes', { name: ' Brand ', colors: ['#FFF', 'rgb(0,0,0)', 'hsl(0 100% 40%)'] })).json(); assert.deepEqual(p.colors, ['#ffffff', '#000000', '#cc0000']); assert.equal(p.name, 'Brand');
  for (const [b, key] of [[{ name: '', colors: ['#fff'] }, 'name'], [{ name: 'x', colors: [] }, 'colors'], [{ name: 'x', colors: ['#fff', '#ffffff'] }, 'colors'], [{ name: 'x', colors: ['#fff', 'bad'] }, 'colors'], [{ name: 'x', colors: ['#ffffff80'] }, 'colors'], [{ name: 'x', colors: Array.from({ length: 13 }, (_, i) => '#00000' + i.toString(16)) }, 'colors']]) { const r = await call('POST', '/palettes', b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[key]); }
  const u = await (await call('PUT', `/palettes/${p.id}`, { name: 'Brand v2', colors: ['#000', '#fff'] })).json(); assert.equal(u.name, 'Brand v2'); assert.equal((await (await call('GET', '/palettes')).json())[0].id, p.id);
  assert.equal((await call('DELETE', `/palettes/${p.id}`)).status, 204); assert.equal((await call('GET', `/palettes/${p.id}`)).status, 404); assert.equal((await call('GET', '/palettes/zz')).status, 400);
});
test('matrix: ordered pairs, diagonal null, levels and below-AA count', async () => {
  const p = await (await call('POST', '/palettes', { name: 'M', colors: ['#000000', '#ffffff', '#777777'] })).json(); const m = await (await call('GET', `/palettes/${p.id}/matrix`)).json();
  assert.equal(m.cells.length, 9); assert.equal(m.cells[0], null); assert.equal(m.cells[4], null); assert.deepEqual(m.cells[1], { fg: '#000000', bg: '#ffffff', ratio: 21, level: 'AAA' });
  const grey = m.cells.find((c) => c && c.fg === '#777777' && c.bg === '#ffffff'); assert.equal(grey.level, 'AA Large'); assert.equal(m.summary.pairs, 6); assert.equal(m.summary.belowAA, 2, '#777 on white and white on #777 are below AA');
});
test('errors, size limit and static serving', async () => {
  assert.equal((await fetch(base + '/api/check', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.equal((await fetch(base + '/api/nope')).status, 404);
  const big = await fetch(base + '/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fg: 'x'.repeat(60_000) }) }).catch(() => ({ status: 413 })); assert.equal(big.status, 413);
  assert.match(await (await fetch(base + '/color.js')).text(), /export function parseColor/); assert.match((await fetch(base + '/')).headers.get('content-security-policy'), /default-src 'self'/);
});
