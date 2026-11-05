// Sudoku engine. Boards are 81-char strings: '1'-'9' or '.' for empty. Pure; shared by server and browser.
export const EMPTY = '.';
export const isBoard = (s) => typeof s === 'string' && /^[1-9.]{81}$/.test(s);
const rowOf = (i) => Math.floor(i / 9), colOf = (i) => i % 9, boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
const PEERS = Array.from({ length: 81 }, (_, i) => { const s = new Set(); for (let j = 0; j < 81; j++) if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) s.add(j); return [...s]; });
export const peers = (i) => PEERS[i];

/** Indices of filled cells that share a row, column or box with an equal digit. */
export function conflicts(board) {
  const bad = new Set(); for (let i = 0; i < 81; i++) if (board[i] !== EMPTY) for (const j of PEERS[i]) if (board[j] === board[i]) { bad.add(i); bad.add(j); }
  return [...bad].sort((a, b) => a - b);
}
export const candidates = (board, i) => { if (board[i] !== EMPTY) return []; const used = new Set(PEERS[i].map((j) => board[j])); return '123456789'.split('').filter((d) => !used.has(d)); };

/** Backtracking with minimum-remaining-values. Returns { count (capped at limit), solution (first found) }. A board with conflicts has 0 solutions. */
export function solve(board, limit = 2, rng = null) {
  if (!isBoard(board) || conflicts(board).length) return { count: 0, solution: null };
  const b = board.split(''); let count = 0, solution = null;
  const go = () => {
    let best = -1, opts = null;
    for (let i = 0; i < 81; i++) if (b[i] === EMPTY) { const c = candidates(b, i); if (!c.length) return; if (!opts || c.length < opts.length) { best = i; opts = c; if (c.length === 1) break; } }
    if (best < 0) { count++; if (!solution) solution = b.join(''); return; }
    const order = rng ? shuffle(opts, rng) : opts;
    for (const d of order) { b[best] = d; go(); if (count >= limit) { b[best] = EMPTY; return; } b[best] = EMPTY; }
  };
  go(); return { count, solution };
}
export function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function shuffle(arr, rng) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export const CLUES = { easy: 40, medium: 32, hard: 26 };

/** Deterministic puzzle with exactly one solution. Returns { puzzle, solution, clues }. */
export function generate(seed, difficulty = 'medium') {
  const target = CLUES[difficulty]; if (!target) throw new RangeError('unknown difficulty');
  const rng = mulberry32(seed), full = solve(EMPTY.repeat(81), 1, rng).solution, p = full.split(''), order = shuffle([...Array(81).keys()], rng); let clues = 81;
  for (const i of order) {
    if (clues <= target) break; const keep = p[i]; p[i] = EMPTY;
    if (solve(p.join(''), 2).count !== 1) p[i] = keep; else clues--;
  }
  return { puzzle: p.join(''), solution: full, clues };
}
export const isSolved = (board, solution) => board === solution;
