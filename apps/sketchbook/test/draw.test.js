import test from 'node:test';
import assert from 'node:assert/strict';
import { simplify, validateDrawing, pathData, toSvg, W, H, LIMITS } from '../src/draw.js';

test('simplify: removes collinear points, keeps corners and endpoints, epsilon 0 is identity', () => {
  const line = Array.from({ length: 50 }, (_, i) => [i * 2, i]); assert.deepEqual(simplify(line, 0.5), [line[0], line.at(-1)]);
  const corner = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]]; assert.deepEqual(simplify(corner, 0.5), [[0, 0], [10, 0], [10, 10]]);
  assert.deepEqual(simplify(corner, 0), corner); assert.deepEqual(simplify([[1, 1]], 1), [[1, 1]]); assert.deepEqual(simplify([[1, 1], [2, 2]], 1), [[1, 1], [2, 2]]); assert.deepEqual(simplify([[3, 3], [3, 3], [3, 3]], 1), [[3, 3], [3, 3]]);
  const wiggle = Array.from({ length: 200 }, (_, i) => [i, Math.sin(i / 5) * 20]); const s = simplify(wiggle, 1); assert.ok(s.length < 100 && s.length > 10); assert.deepEqual(s[0], wiggle[0]); assert.deepEqual(s.at(-1), wiggle.at(-1));
  const t = Date.now(); simplify(Array.from({ length: 5000 }, (_, i) => [i % 800, (i * 7) % 600]), 0.8); assert.ok(Date.now() - t < 500, 'no quadratic blow-up / stack overflow on 5000 points');
});
test('simplify: error stays within epsilon of the original polyline', () => {
  const pts = Array.from({ length: 300 }, (_, i) => [i * 2, 100 + Math.sin(i / 9) * 40 + Math.cos(i / 3) * 3]); const eps = 1.5, s = simplify(pts, eps);
  const dist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  for (const p of pts) assert.ok(Math.min(...s.slice(1).map((b, i) => dist(p, s[i], b))) <= eps + 1e-9);
});
const stroke = (o = {}) => ({ tool: 'pen', color: '#FF0000', size: 4, points: [[10, 10], [20, 20]], ...o });
test('validateDrawing: normalizes (clamp, round, lowercase colour) and accepts empty drawings', () => {
  const r = validateDrawing({ title: ' Cat ', strokes: [stroke({ points: [[-5, 700.26], [1000, 5.04]] })] }); assert.deepEqual(r.value.strokes[0].points, [[0, H], [W, 5]]); assert.equal(r.value.strokes[0].color, '#ff0000'); assert.equal(r.value.title, 'Cat');
  assert.deepEqual(validateDrawing({ title: 'x', strokes: [] }).value.strokes, []);
});
test('validateDrawing rejects malformed input with specific messages', () => {
  const bad = (b, re) => assert.match(validateDrawing(b).errors.strokes ?? validateDrawing(b).errors.title ?? '', re, JSON.stringify(b).slice(0, 80));
  bad({ title: '', strokes: [] }, /required/); bad({ title: 'x'.repeat(81), strokes: [] }, /≤ 80/); bad({ title: 'x' }, /must be a list/); bad({ title: 'x', strokes: [stroke({ tool: 'laser' })] }, /Stroke 1 is invalid/); bad({ title: 'x', strokes: [stroke({ color: 'red' })] }, /invalid/);
  bad({ title: 'x', strokes: [stroke({ color: 'url(javascript:1)' })] }, /invalid/); bad({ title: 'x', strokes: [stroke({ size: 0 })] }, /invalid/); bad({ title: 'x', strokes: [stroke({ size: 61 })] }, /invalid/); bad({ title: 'x', strokes: [stroke({ points: [] })] }, /invalid/);
  bad({ title: 'x', strokes: [stroke({ points: [[1, 'a']] })] }, /invalid point/); bad({ title: 'x', strokes: [stroke({ points: [[1, NaN]] })] }, /invalid point/); bad({ title: 'x', strokes: [stroke({ points: [[1, 2, 3]] })] }, /invalid point/); bad({ title: 'x', strokes: Array(LIMITS.strokes + 1).fill(stroke()) }, /At most/);
  bad({ title: 'x', strokes: [stroke({ points: Array(LIMITS.pointsPerStroke + 1).fill([1, 1]) })] }, /too many points/); bad({ title: 'x', strokes: Array(50).fill(stroke({ points: Array(LIMITS.pointsPerStroke).fill([1, 1]) })) }, /Too many points in total/); assert.ok(validateDrawing(null).errors.title);
});
test('toSvg is injection-proof even for unvalidated input', () => {
  const evil = toSvg([{ tool: 'pen', color: '"/><script>alert(1)</script>', size: 'x', points: [['1"onload="x', 5], [9e99, -4], null] }, { tool: 'pen', color: '#12abEF', size: 3, points: [[1, 1]] }, { tool: 'pen', color: '#000000', size: 3, points: [] }]);
  assert.ok(!/script|onload|alert/.test(evil)); assert.match(evil, /stroke="#000000"/); assert.match(evil, /fill="#12abef"/); assert.equal((evil.match(/<circle/g) || []).length, 1);
});
test('pathData and toSvg: smooth curves, dots, eraser is background-coloured, only safe characters', () => {
  assert.equal(pathData([[1, 2]]), 'M1 2'); assert.equal(pathData([[1, 2], [3, 4]]), 'M1 2L3 4'); assert.equal(pathData([[0, 0], [10, 0], [20, 10]]), 'M0 0Q10 0 15 5L20 10');
  const svg = toSvg([stroke({ points: [[5, 5]], size: 10 }), stroke({ tool: 'eraser', color: '#00ff00', points: [[1, 1], [9, 9]] }), stroke({ color: '#0000ff', points: [[0, 0], [5, 5], [9, 0]] })]);
  assert.match(svg, /^<svg [^>]*viewBox="0 0 800 600"/); assert.match(svg, /<circle cx="5" cy="5" r="5" fill="#ff0000"\/>/); assert.match(svg, /stroke="#ffffff"/); assert.ok(!svg.includes('#00ff00'), 'eraser colour never leaks'); assert.match(svg, /<rect width="800" height="600" fill="#ffffff"\/>/);
  assert.ok(!toSvg([], { background: false }).includes('<rect')); assert.match(svg, /^[\x20-\x7e]+$/, 'ASCII only'); assert.ok(!/[<>]/.test(svg.replace(/<[^>]+>/g, '')), 'no stray markup');
});
