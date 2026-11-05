// Shared by server, browser and tests: validation, simplification and SVG output for vector drawings.
export const W = 800, H = 600;
export const LIMITS = { strokes: 2000, pointsPerStroke: 5000, totalPoints: 200_000, title: 80, size: [1, 60] };
export const TOOLS = ['pen', 'eraser'];
export const BG = '#ffffff';
const COLOR = /^#[0-9a-fA-F]{6}$/;
const r1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
/** Ramer–Douglas–Peucker, iterative (safe for thousands of points). Always keeps the first and last point. */
export function simplify(points, epsilon = 0.8) {
  if (points.length < 3 || epsilon <= 0) return points.slice();
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); let max = -1, idx = -1;
    for (let i = s + 1; i < e; i++) { const d = perpDist(points[i], points[s], points[e]); if (d > max) { max = d; idx = i; } }
    if (max > epsilon) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** {value} or {errors}. Coordinates are clamped into the canvas and rounded to 0.1 px. */
export function validateDrawing(b) {
  const errors = {}; b = b && typeof b === 'object' ? b : {};
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title) errors.title = 'Title is required'; else if (title.length > LIMITS.title) errors.title = `Title must be ≤ ${LIMITS.title} characters`;
  const strokes = []; let total = 0;
  if (!Array.isArray(b.strokes)) errors.strokes = 'strokes must be a list';
  else if (b.strokes.length > LIMITS.strokes) errors.strokes = `At most ${LIMITS.strokes} strokes`;
  else for (const [i, s] of b.strokes.entries()) {
    if (!s || typeof s !== 'object' || !TOOLS.includes(s.tool) || !COLOR.test(s.color ?? '') || !Number.isFinite(s.size) || s.size < LIMITS.size[0] || s.size > LIMITS.size[1] || !Array.isArray(s.points) || !s.points.length) { errors.strokes = `Stroke ${i + 1} is invalid`; break; }
    if (s.points.length > LIMITS.pointsPerStroke) { errors.strokes = `Stroke ${i + 1} has too many points`; break; }
    const pts = []; for (const p of s.points) { if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { errors.strokes = `Stroke ${i + 1} has an invalid point`; break; } pts.push([r1(clamp(p[0], 0, W)), r1(clamp(p[1], 0, H))]); }
    if (errors.strokes) break;
    total += pts.length; if (total > LIMITS.totalPoints) { errors.strokes = `Too many points in total (max ${LIMITS.totalPoints})`; break; }
    strokes.push({ tool: s.tool, color: s.color.toLowerCase(), size: Math.round(s.size * 10) / 10, points: pts });
  }
  if (Object.keys(errors).length) return { errors };
  return { value: { title, strokes } };
}

/** SVG path data using quadratic curves through midpoints (smooth, compact). Inputs are numbers only. */
export function pathData(points) {
  if (points.length === 1) return `M${points[0][0]} ${points[0][1]}`;
  if (points.length === 2) return `M${points[0][0]} ${points[0][1]}L${points[1][0]} ${points[1][1]}`;
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) d += `Q${points[i][0]} ${points[i][1]} ${r1((points[i][0] + points[i + 1][0]) / 2)} ${r1((points[i][1] + points[i + 1][1]) / 2)}`;
  const l = points.at(-1); return d + `L${l[0]} ${l[1]}`;
}
const safeColor = (c) => (COLOR.test(String(c)) ? String(c).toLowerCase() : '#000000');
const num = (n, lo, hi, d = 0) => (Number.isFinite(n) ? r1(clamp(n, lo, hi)) : d);
/** Defensive: even unvalidated strokes can only ever produce numbers and #rrggbb colours in the output. */
export function toSvg(strokes, { background = true } = {}) {
  const body = strokes.map((s) => {
    const c = s.tool === 'eraser' ? BG : safeColor(s.color), size = num(s.size, LIMITS.size[0], LIMITS.size[1], 1), pts = (Array.isArray(s.points) ? s.points : []).map((p) => [num(p?.[0], 0, W), num(p?.[1], 0, H)]);
    if (!pts.length) return '';
    return pts.length === 1 ? `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="${r1(size / 2)}" fill="${c}"/>`
      : `<path d="${pathData(pts)}" fill="none" stroke="${c}" stroke-width="${size}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${background ? `<rect width="${W}" height="${H}" fill="${BG}"/>` : ''}${body}</svg>`;
}
