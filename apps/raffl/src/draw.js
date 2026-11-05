// Verifiable random draws. Pure; shared by server and browser. Every result is reproducible from (seed, input).
/** xmur3 string hash → 32-bit seed. */
export function seedFrom(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; }
/** mulberry32 PRNG → () => [0,1) */
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Unbiased integer in [0, n) via rejection-free scaling of a 32-bit-resolution float (bias < 2^-32). */
export const randInt = (r, n) => Math.floor(r() * n);
/** Fisher–Yates; returns a new array. */
export function shuffle(items, r) { const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = randInt(r, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/** Parse one entry per line: "Name" or "Name x3" / "Name*3" (weight). Blank lines ignored; duplicate names are merged by summing weights. */
export function parseEntries(text) {
  const map = new Map(), errors = [];
  String(text ?? '').split('\n').forEach((raw, i) => {
    const line = raw.trim(); if (!line) return; const m = /^(.*?)(?:(?:\s+x\s*|\s*[*×]\s*)(\d+))?$/i.exec(line); const name = m[1].trim(), w = m[2] === undefined ? 1 : Number(m[2]);
    if (!name) { errors.push(`Line ${i + 1}: name is empty`); return; } if (name.length > 60) { errors.push(`Line ${i + 1}: name is longer than 60 characters`); return; } if (w < 1 || w > 1000) { errors.push(`Line ${i + 1}: weight must be 1–1000`); return; }
    const key = name.toLowerCase(), cur = map.get(key); map.set(key, cur ? { name: cur.name, weight: cur.weight + w } : { name, weight: w });
  });
  return { entries: [...map.values()], errors };
}
/** Draw `count` distinct winners; probability of the next winner is proportional to the weight of remaining entries (successive sampling). */
export function drawWinners(entries, count, r) {
  const pool = entries.map((e) => ({ ...e })), out = [];
  while (out.length < count && pool.length) { const total = pool.reduce((s, e) => s + e.weight, 0); let x = r() * total, k = 0; for (; k < pool.length - 1; k++) { x -= pool[k].weight; if (x < 0) break; } out.push(pool[k].name); pool.splice(k, 1); }
  return out;
}
/** Split names into `groups` groups as evenly as possible (sizes differ by at most 1) after a seeded shuffle. */
export function makeGroups(names, groups, r) { const s = shuffle(names, r), out = Array.from({ length: groups }, () => []); s.forEach((n, i) => out[i % groups].push(n)); return out; }
/** Pair people off for a gift exchange: a derangement (nobody draws themselves), by retrying shuffles; a single cycle option makes one big ring. */
export function secretSanta(names, r, { ring = true } = {}) {
  if (names.length < 2) return null;
  if (ring) { const o = shuffle(names, r); return Object.fromEntries(o.map((n, i) => [n, o[(i + 1) % o.length]])); }
  for (let t = 0; t < 1000; t++) { const o = shuffle(names, r); if (o.every((x, i) => x !== names[i])) return Object.fromEntries(names.map((n, i) => [n, o[i]])); } return null;
}
