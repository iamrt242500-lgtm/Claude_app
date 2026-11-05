// Column type inference and profiling.
const NULLS = new Set(['', 'na', 'n/a', 'null', 'nan', 'none', '-']);
export const isNull = (v) => v == null || NULLS.has(String(v).trim().toLowerCase());
const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const toNum = (v) => { const s = String(v).trim().replace(/,(?=\d{3}(\D|$))/g, ''); return NUM.test(s) ? Number(s) : NaN; };
const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;
const isDate = (v) => DATE.test(String(v).trim()) && !Number.isNaN(Date.parse(String(v).trim().replace(' ', 'T')));
const BOOL = new Set(['true', 'false', 'yes', 'no']);

export function inferType(values) {
  const vs = values.filter((v) => !isNull(v));
  if (!vs.length) return 'empty';
  if (vs.every((v) => !Number.isNaN(toNum(v)))) return 'number';
  if (vs.every((v) => BOOL.has(String(v).trim().toLowerCase()))) return 'boolean';
  if (vs.every(isDate)) return 'date';
  return 'text';
}
export { toNum };

const r = (x, p = 4) => (x == null ? null : Math.round(x * 10 ** p) / 10 ** p);
function quantile(sorted, p) { const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }

export function profileColumn(name, values) {
  const type = inferType(values);
  const nonNull = values.filter((v) => !isNull(v));
  const counts = new Map();
  for (const v of nonNull) counts.set(String(v).trim(), (counts.get(String(v).trim()) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([value, count]) => ({ value, count }));
  const out = { name, type, count: values.length, nulls: values.length - nonNull.length, unique: counts.size, top };
  if (type === 'number' && nonNull.length) {
    const nums = nonNull.map(toNum).sort((a, b) => a - b);
    const mean = nums.reduce((s, x) => s + x, 0) / nums.length;
    const sd = Math.sqrt(nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length);
    const min = nums[0], max = nums.at(-1), bins = Math.min(10, Math.max(1, counts.size));
    const hist = Array.from({ length: bins }, (_, i) => ({ from: r(min + ((max - min) * i) / bins), to: r(min + ((max - min) * (i + 1)) / bins), count: 0 }));
    for (const x of nums) hist[max === min ? 0 : Math.min(bins - 1, Math.floor(((x - min) / (max - min)) * bins))].count++;
    Object.assign(out, { min, max, mean: r(mean), median: r(quantile(nums, 0.5)), p25: r(quantile(nums, 0.25)), p75: r(quantile(nums, 0.75)), std: r(sd), sum: r(nums.reduce((s, x) => s + x, 0)), hist });
  }
  if (type === 'date' && nonNull.length) { const s = nonNull.map((v) => String(v).trim()).sort(); out.min = s[0]; out.max = s.at(-1); }
  return out;
}

export function uniqueHeaders(raw) {
  const seen = new Map();
  return raw.map((h, i) => {
    let n = String(h).trim() || `column_${i + 1}`;
    const c = seen.get(n) || 0; seen.set(n, c + 1);
    return c ? `${n}_${c + 1}` : n;
  });
}

export function aggregate(rows, columns, { group, metric, fn }) {
  const types = Object.fromEntries(columns.map((c) => [c.name, c.type]));
  if (!(group in types)) throw new RangeError('Unknown group column');
  if (!['count', 'sum', 'avg', 'min', 'max'].includes(fn)) throw new RangeError('fn must be count, sum, avg, min or max');
  if (fn !== 'count') { if (types[metric] !== 'number') throw new RangeError('Metric must be a numeric column'); }
  const g = new Map();
  for (const row of rows) {
    const k = isNull(row[group]) ? '(empty)' : String(row[group]).trim();
    const e = g.get(k) || { n: 0, sum: 0, min: Infinity, max: -Infinity, vals: 0 };
    e.n++;
    if (fn !== 'count') { const x = toNum(row[metric]); if (!Number.isNaN(x)) { e.sum += x; e.vals++; e.min = Math.min(e.min, x); e.max = Math.max(e.max, x); } }
    g.set(k, e);
  }
  const out = [...g.entries()].map(([key, e]) => ({ key, value: r(fn === 'count' ? e.n : fn === 'sum' ? e.sum : fn === 'avg' ? (e.vals ? e.sum / e.vals : null) : fn === 'min' ? (e.vals ? e.min : null) : (e.vals ? e.max : null)) }));
  out.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.key.localeCompare(b.key));
  return out;
}
