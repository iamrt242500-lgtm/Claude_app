// Ingredient parsing, scaling, unit conversion and shopping-list aggregation. Shared by server, browser and tests.
const UNICODE = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
// unit -> [canonical, dimension, size in base unit (ml for volume, g for weight)]
const UNITS = {};
const def = (canon, dim, size, aliases) => { for (const a of [canon, ...aliases]) UNITS[a] = [canon, dim, size]; };
def('tsp', 'volume', 4.92892, ['teaspoon', 'teaspoons', 'tsps', 't']); def('tbsp', 'volume', 14.7868, ['tablespoon', 'tablespoons', 'tbsps', 'tbs', 'tbl', 'T']);
def('cup', 'volume', 236.588, ['cups', 'c']); def('fl oz', 'volume', 29.5735, ['floz']); def('ml', 'volume', 1, ['milliliter', 'milliliters', 'millilitre', 'millilitres']); def('l', 'volume', 1000, ['liter', 'liters', 'litre', 'litres']);
def('g', 'weight', 1, ['gram', 'grams', 'gr']); def('kg', 'weight', 1000, ['kilogram', 'kilograms', 'kgs']); def('oz', 'weight', 28.3495, ['ounce', 'ounces']); def('lb', 'weight', 453.592, ['lbs', 'pound', 'pounds']);
export const SYSTEMS = ['original', 'metric', 'us'];

const NUM = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)`;
const RANGE = new RegExp(String.raw`^(${NUM})\s*(?:-|–|—|to)\s*(${NUM})(?=\s|$|[A-Za-z])`, 'i'), SINGLE = new RegExp(String.raw`^(${NUM})`);
export function toNumber(s) {
  const t = String(s).trim(); let m;
  if ((m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t))) return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : NaN;
  if ((m = /^(\d+)\/(\d+)$/.exec(t))) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : NaN;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}
const prep = (line) => String(line ?? '').replace(/[½⅓⅔¼¾⅕⅛⅜⅝⅞]/g, (c, i, s) => (/\d/.test(s[i - 1] ?? '') ? ' ' : '') + UNICODE[c]).replace(/\s+/g, ' ').trim();

/** "1 1/2 cups all-purpose flour, sifted" → {qty:{min,max}|null, unit, name, note, raw}. Never throws. */
export function parseIngredient(raw) {
  const line = prep(raw); if (!line) return { qty: null, unit: null, name: '', note: '', raw: String(raw ?? '') };
  let rest = line, qty = null, m;
  if ((m = RANGE.exec(rest)) && toNumber(m[1]) <= toNumber(m[2])) { qty = { min: toNumber(m[1]), max: toNumber(m[2]) }; rest = rest.slice(m[0].length).trim(); }
  else if ((m = SINGLE.exec(rest))) { const v = toNumber(m[1]); if (Number.isFinite(v)) { qty = { min: v, max: v }; rest = rest.slice(m[0].length).trim(); } }
  let unit = null;
  if (qty) {
    const um = /^([A-Za-z]+\.?)(?:\s|$)/.exec(rest); let key = um ? um[1].replace(/\.$/, '') : null;
    if (key && /^fl\.?$/i.test(key) && /^fl\.?\s+oz\b/i.test(rest)) { unit = 'fl oz'; rest = rest.replace(/^fl\.?\s+oz\.?/i, '').trim(); }
    else if (key && (UNITS[key] || UNITS[key.toLowerCase()]) && !(key === 'T' && false)) { const hit = UNITS[key] ?? UNITS[key.toLowerCase()]; unit = hit[0]; rest = rest.slice(um[0].length).trim(); }
    rest = rest.replace(/^of\s+/i, '');
  }
  let name = rest, note = ''; const ci = rest.indexOf(','); if (ci >= 0) { name = rest.slice(0, ci).trim(); note = rest.slice(ci + 1).trim(); }
  name = name.replace(/^\(([^)]*)\)\s*/, (_, p) => { note = note ? p + ', ' + note : p; return ''; }).trim();
  return { qty, unit, name, note, raw: String(raw) };
}

const FR = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];
/** 1.5 → "1½", 0.3333 → "⅓", 2 → "2", 2.37 → "2.37" (nearest eighth/third only when within 0.02). */
export function formatQty(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  const whole = Math.floor(n + 1e-9), frac = n - whole;
  let best = null; for (const [v, s] of FR) if (Math.abs(frac - v) < 0.02 && (!best || Math.abs(frac - v) < Math.abs(frac - best[0]))) best = [v, s];
  if (best) { const w = best[0] === 1 ? whole + 1 : whole; if (w === 0 && !best[1] && n > 0) return String(Math.round(n * 100) / 100 || n);   // tiny positive amounts must not display as "0"
    return `${w || (best[1] ? '' : '0')}${best[1]}` || '0'; }
  return String(Math.round(n * 100) / 100);
}
const fmtRange = (q) => (q.min === q.max ? formatQty(q.min) : `${formatQty(q.min)}–${formatQty(q.max)}`);

/** Convert a quantity to the base unit of its dimension: {dim, value} (count items have dim 'count'). */
export function toBase(qty, unit) { const u = unit && UNITS[unit] ? UNITS[unit] : null; return u ? { dim: u[1], min: qty.min * u[2], max: qty.max * u[2] } : { dim: 'count', min: qty.min, max: qty.max }; }
/** Choose a readable unit for a base value in the requested system. */
export function fromBase(value, dim, system = 'metric') {
  if (dim === 'count') return { value, unit: null };
  if (dim === 'volume') {
    if (system === 'us') { if (value < 3 * 4.92892 - 0.01) return { value: value / 4.92892, unit: 'tsp' }; if (value < 59.15 - 0.01) return { value: value / 14.7868, unit: 'tbsp' }; return { value: value / 236.588, unit: 'cup' }; }
    return value >= 1000 ? { value: value / 1000, unit: 'l' } : { value, unit: 'ml' };
  }
  if (system === 'us') return value >= 453.592 ? { value: value / 453.592, unit: 'lb' } : { value: value / 28.3495, unit: 'oz' };
  return value >= 1000 ? { value: value / 1000, unit: 'kg' } : { value, unit: 'g' };
}
const roundFor = (v, unit) => (unit === 'g' || unit === 'ml' ? Math.round(v / (v >= 100 ? 5 : 1)) * (v >= 100 ? 5 : 1) : v);   // 247 g → 245 g; 12 ml stays 12

/** Render a parsed ingredient scaled by `factor` in the given unit system. */
export function renderIngredient(p, factor = 1, system = 'original') {
  const label = [p.name, p.note ? `, ${p.note}` : ''].join('');
  if (!p.qty) return { text: p.raw.trim(), qtyText: '', name: p.name, scaled: false };
  const q = { min: p.qty.min * factor, max: p.qty.max * factor };
  if (!p.unit || system === 'original' || !UNITS[p.unit]) return { text: `${fmtRange(q)}${p.unit ? ' ' + p.unit : ''} ${label}`.trim(), qtyText: `${fmtRange(q)}${p.unit ? ' ' + p.unit : ''}`, name: label, scaled: true };
  const b = toBase(q, p.unit), lo = fromBase(b.min, b.dim, system), hi = fromBase(b.max, b.dim, system), unit = lo.unit, hiv = hi.unit === unit ? hi.value : b.max / (b.min / lo.value || 1);
  const fmt = (v) => (unit === 'g' || unit === 'ml' ? String(roundFor(v, unit)) : formatQty(v));
  const qtyText = (lo.value === hiv || fmt(lo.value) === fmt(hiv) ? fmt(lo.value) : `${fmt(lo.value)}–${fmt(hiv)}`) + ' ' + unit;
  return { text: `${qtyText} ${label}`.trim(), qtyText, name: label, scaled: true };
}

/** Light singularization so "2 eggs" + "1 egg", "3 tomatoes" + "1 tomato" merge; leaves "molasses", "hummus", "asparagus" alone. */
export function ingredientKey(name) {
  let n = String(name).toLowerCase().replace(/\s+/g, ' ').trim(); if (!n) return '';
  const words = n.split(' '), w = words.pop();
  const keep = /(ss|us|is|as)$/.test(w) || ['molasses', 'hummus', 'couscous', 'asparagus', 'swiss', 'lentils'].includes(w);
  let s = w; if (!keep && w.length > 3) { if (/ies$/.test(w)) s = w.slice(0, -3) + 'y'; else if (/(oes|ches|shes|xes)$/.test(w)) s = w.slice(0, -2); else if (/s$/.test(w)) s = w.slice(0, -1); }
  return [...words, s].join(' ');
}
/** Aggregate [{name, qty, unit}] (already scaled) into shopping lines: same ingredient + same dimension are summed in base units. */
export function aggregate(items, system = 'metric') {
  const map = new Map();
  for (const it of items) {
    const key = ingredientKey(it.name); if (!key) continue;
    if (!it.qty) { const k = key + '|none'; if (!map.has(k)) map.set(k, { key, name: it.name, dim: 'none', min: 0, max: 0, sources: 0 }); map.get(k).sources++; continue; }
    const b = toBase(it.qty, it.unit), k = key + '|' + b.dim, e = map.get(k) ?? { key, name: it.name, dim: b.dim, min: 0, max: 0, sources: 0 };
    e.min += b.min; e.max += b.max; e.sources++; map.set(k, e);
  }
  return [...map.values()].map((e) => {
    let qtyText = '';
    if (e.dim === 'count') qtyText = e.min === e.max ? formatQty(e.min) : `${formatQty(e.min)}–${formatQty(e.max)}`;
    else if (e.dim !== 'none') { const lo = fromBase(e.min, e.dim, system), hi = fromBase(e.max, e.dim, system); const f = (v) => (lo.unit === 'g' || lo.unit === 'ml' ? String(roundFor(v, lo.unit)) : formatQty(v)); qtyText = (f(lo.value) === f(hi.unit === lo.unit ? hi.value : lo.value) ? f(lo.value) : `${f(lo.value)}–${f(hi.value)}`) + ' ' + lo.unit; }
    return { key: e.key + '|' + e.dim, name: e.name.toLowerCase(), dim: e.dim, qtyText, sources: e.sources };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
