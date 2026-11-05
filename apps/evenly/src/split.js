// Money is integer cents. Pure functions: splitting, balances and settle-up.
export class SplitError extends Error {}
export const toCents = (v) => { const s = String(v ?? '').trim().replace(/,/g, ''); if (!/^\d+(\.\d{1,2})?$/.test(s)) return null; const [w, f = ''] = s.split('.'); const n = Number(w) * 100 + Number(f.padEnd(2, '0')); return Number.isSafeInteger(n) ? n : null; };

/** Split `total` cents across `weights` ({id: weight>0}) using the largest-remainder method. Ties go to the lowest id. Sum is always exactly `total`. */
export function splitByWeights(total, weights) {
  const ids = Object.keys(weights).map(Number).sort((a, b) => a - b);
  if (!ids.length) throw new SplitError('Choose at least one person to split between');
  const sum = ids.reduce((s, id) => s + weights[id], 0);
  if (!(sum > 0) || ids.some((id) => !(weights[id] > 0))) throw new SplitError('Shares must be positive numbers');
  const out = {}, rem = [];
  let given = 0;
  for (const id of ids) { const exact = (total * weights[id]) / sum, base = Math.floor(exact + 1e-9); out[id] = base; given += base; rem.push({ id, frac: exact - base }); }
  rem.sort((a, b) => b.frac - a.frac || a.id - b.id);
  for (let i = 0; i < total - given; i++) out[rem[i].id]++;
  return out;
}
export const splitEqual = (total, ids) => splitByWeights(total, Object.fromEntries(ids.map((id) => [id, 1])));

/** Compute per-person owed cents from an expense split spec. */
export function computeShares(total, spec) {
  if (!spec || typeof spec !== 'object') throw new SplitError('Missing split');
  if (spec.type === 'equal') {
    const ids = [...new Set((spec.members || []).map(Number))];
    if (!ids.length || ids.some((i) => !Number.isInteger(i))) throw new SplitError('Choose at least one person to split between');
    return splitEqual(total, ids);
  }
  if (spec.type === 'shares' || spec.type === 'percent') {
    const w = {};
    for (const [id, v] of Object.entries(spec.values || {})) { const n = Number(v); if (n > 0) w[Number(id)] = n; else if (v !== 0 && v !== '0' && v !== '' && v != null) throw new SplitError('Shares must be positive numbers'); }
    if (spec.type === 'percent' && Math.abs(Object.values(w).reduce((s, x) => s + x, 0) - 100) > 0.001) throw new SplitError('Percentages must add up to 100');
    return splitByWeights(total, w);
  }
  if (spec.type === 'exact') {
    const out = {}; let sum = 0;
    for (const [id, v] of Object.entries(spec.values || {})) { const c = v === '' || v == null || Number(v) === 0 ? 0 : toCents(v); if (c == null) throw new SplitError('Invalid amount'); if (c > 0) { out[Number(id)] = c; sum += c; } }
    if (sum !== total) throw new SplitError(`Amounts add up to ${(sum / 100).toFixed(2)} but the total is ${(total / 100).toFixed(2)}`);
    if (!Object.keys(out).length) throw new SplitError('Choose at least one person to split between');
    return out;
  }
  throw new SplitError('Unknown split type');
}

/** balances[id] > 0 means the person is owed money; < 0 means they owe. */
export function balances(memberIds, expenses, settlements = []) {
  const b = Object.fromEntries(memberIds.map((id) => [id, 0]));
  for (const e of expenses) { b[e.paidBy] += e.amount; for (const [id, c] of Object.entries(e.shares)) b[id] -= c; }
  for (const s of settlements) { b[s.from] += s.amount; b[s.to] -= s.amount; }
  return b;
}

/** Greedy settle-up: at most (n-1) transfers; deterministic. */
export function settleUp(bal) {
  const cred = [], debt = [];
  for (const [id, v] of Object.entries(bal)) { if (v > 0) cred.push({ id: Number(id), v }); else if (v < 0) debt.push({ id: Number(id), v: -v }); }
  const order = (a, b) => b.v - a.v || a.id - b.id;
  cred.sort(order); debt.sort(order);
  const out = []; let i = 0, j = 0;
  while (i < cred.length && j < debt.length) {
    const amt = Math.min(cred[i].v, debt[j].v);
    out.push({ from: debt[j].id, to: cred[i].id, amount: amt });
    cred[i].v -= amt; debt[j].v -= amt;
    if (cred[i].v === 0) i++; if (debt[j].v === 0) j++;
  }
  return out;
}
