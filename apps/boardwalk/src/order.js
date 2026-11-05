/** Pure ordering helpers. */
/** Move `id` to `index` within `ids` (index clamped). Returns a new array. */
export function reorder(ids, id, index) {
  const rest = ids.filter((x) => x !== id);
  const i = Math.max(0, Math.min(rest.length, Number.isInteger(index) ? index : rest.length));
  rest.splice(i, 0, id);
  return rest;
}
export function normalizeLabels(labels) {
  const arr = Array.isArray(labels) ? labels : String(labels ?? '').split(',');
  const out = [];
  for (const l of arr) { const v = String(l).trim().toLowerCase().slice(0, 20); if (v && !out.includes(v)) out.push(v); }
  return out.slice(0, 6);
}
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
