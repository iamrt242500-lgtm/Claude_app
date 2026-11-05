// Tournament logic. Pure; shared by server and browser.
/** Round-robin pairings by the circle method. Returns rounds of [a, b] (indices); a bye is represented by null. */
export function roundRobin(n) {
  if (n < 2) return []; const ids = [...Array(n).keys()]; if (n % 2) ids.push(null); const m = ids.length, rounds = [];
  for (let r = 0; r < m - 1; r++) { const round = []; for (let i = 0; i < m / 2; i++) { const a = ids[i], b = ids[m - 1 - i]; if (a !== null && b !== null) round.push(r % 2 && i === 0 ? [b, a] : [a, b]); } rounds.push(round); ids.splice(1, 0, ids.pop()); }
  return rounds;
}
/** Standard single-elimination seeding order for a bracket of `size` (power of two): [1,8,4,5,2,7,3,6] for 8. Returns 1-based seeds in slot order. */
export function seedOrder(size) { let o = [1]; while (o.length < size) { const n = o.length * 2; o = o.flatMap((s) => [s, n + 1 - s]); } return o; }
export const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };
/**
 * Single-elimination bracket. `n` players seeded 1..n; byes go to the top seeds.
 * Returns rounds[r] = array of matches { slot: [seedA|null, seedB|null] } for round 0; later rounds reference the winners of matches r-1 (2i, 2i+1).
 */
export function bracket(n) {
  if (n < 2) return { size: 1, rounds: [] }; const size = nextPow2(n), order = seedOrder(size), first = [];
  for (let i = 0; i < size; i += 2) { const a = order[i] <= n ? order[i] : null, b = order[i + 1] <= n ? order[i + 1] : null; first.push({ slot: [a, b] }); }
  const rounds = [first]; for (let m = first.length / 2; m >= 1; m /= 2) rounds.push(Array.from({ length: m }, () => ({ slot: [null, null] }))); return { size, rounds };
}
/** Number of rounds in single elimination. */
export const roundCount = (n) => (n < 2 ? 0 : Math.log2(nextPow2(n)));
/**
 * Standings from finished games [{ a, b, sa, sb }] (indices, scores). win=3, draw=1, loss=0 (configurable).
 * Tiebreaks: points, head-to-head points among the tied group, goal difference, goals for, then name order (stable by index).
 */
export function standings(n, games, { win = 3, draw = 1, loss = 0 } = {}) {
  const t = Array.from({ length: n }, (_, i) => ({ i, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 })); const h2h = new Map();
  const add = (x, y, pts) => h2h.set(`${x}:${y}`, (h2h.get(`${x}:${y}`) || 0) + pts);
  for (const g of games) {
    const A = t[g.a], B = t[g.b]; A.played++; B.played++; A.gf += g.sa; A.ga += g.sb; B.gf += g.sb; B.ga += g.sa;
    if (g.sa > g.sb) { A.won++; B.lost++; A.points += win; B.points += loss; add(g.a, g.b, win); add(g.b, g.a, loss); }
    else if (g.sa < g.sb) { B.won++; A.lost++; B.points += win; A.points += loss; add(g.b, g.a, win); add(g.a, g.b, loss); }
    else { A.drawn++; B.drawn++; A.points += draw; B.points += draw; add(g.a, g.b, draw); add(g.b, g.a, draw); }
  }
  for (const r of t) r.gd = r.gf - r.ga;
  const sorted = [...t].sort((x, y) => y.points - x.points || x.i - y.i), out = []; let i = 0;
  while (i < sorted.length) {
    let j = i; while (j < sorted.length && sorted[j].points === sorted[i].points) j++;
    const group = sorted.slice(i, j);
    if (group.length > 1) { const ids = new Set(group.map((r) => r.i)); const hp = (r) => group.reduce((s, o) => (o.i !== r.i && ids.has(o.i) ? s + (h2h.get(`${r.i}:${o.i}`) || 0) : s), 0); group.sort((x, y) => hp(y) - hp(x) || y.gd - x.gd || y.gf - x.gf || x.i - y.i); }
    out.push(...group); i = j;
  }
  let rank = 0; return out.map((r, k) => { const prev = out[k - 1]; return { ...r, rank: (rank = k + 1) }; });
}
