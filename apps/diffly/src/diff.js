// Myers O(ND) diff, line- and word-level, with unified-diff output. Shared by server, browser and tests.
export const LIMITS = { text: 400_000, lines: 8000, maxEdits: 6000 };

export function splitLines(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n'); if (t === '') return [];
  const lines = t.split('\n'); if (lines.at(-1) === '') lines.pop();   // a trailing newline does not create an extra empty line
  return lines;
}
const norm = (s, o) => { let x = s; if (o.ignoreCase) x = x.toLowerCase(); if (o.ignoreWhitespace) x = x.replace(/\s+/g, ' ').trim(); return x; };

/**
 * Minimal edit script between two arrays of comparable keys. Returns ops [{t:'=',a,b} | {t:'-',a} | {t:'+',b}] in order,
 * or null when the edit distance exceeds `maxEdits` (caller falls back to a coarse replace).
 */
export function myers(A, B, maxEdits = LIMITS.maxEdits) {
  const N = A.length, M = B.length, MAX = Math.min(N + M, maxEdits), offset = MAX + 1;
  if (N === 0 && M === 0) return [];
  const V = new Int32Array(2 * MAX + 3), trace = [];
  for (let d = 0; d <= MAX; d++) {
    trace.push(V.slice(offset - d - 1, offset + d + 2));   // snapshot of the diagonals reachable at step d (relative window)
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[offset + k - 1] < V[offset + k + 1]) ? V[offset + k + 1] : V[offset + k - 1] + 1, y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      V[offset + k] = x;
      if (x >= N && y >= M) return backtrack(trace, A, B, d, offset);
    }
  }
  return null;
}
function backtrack(trace, A, B, D, offset) {
  const ops = []; let x = A.length, y = B.length;
  for (let d = D; d > 0; d--) {
    const snap = trace[d], at = (k) => snap[k + d + 1];   // value of V[k] BEFORE step d (the snapshot was taken at the start of step d)
    const k = x - y, prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1, prevX = at(prevK), prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push({ t: '=', a: x, b: y }); }
    if (x === prevX) { y--; ops.push({ t: '+', b: y }); } else { x--; ops.push({ t: '-', a: x }); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ t: '=', a: x, b: y }); }
  return ops.reverse();
}

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
/** Word-level segments for a changed line pair: [{t:'=',text}|{t:'-',text}|{t:'+',text}] for each side. */
export function wordDiff(left, right, opts = {}) {
  const a = left.match(TOKEN) ?? [], b = right.match(TOKEN) ?? [];
  const ops = myers(a.map((x) => norm(x, { ...opts, ignoreWhitespace: false })), b.map((x) => norm(x, { ...opts, ignoreWhitespace: false })), 2000);
  if (!ops) return { left: [{ t: '-', text: left }], right: [{ t: '+', text: right }] };
  const L = [], R = [], push = (arr, t, text) => { if (arr.length && arr.at(-1).t === t) arr.at(-1).text += text; else arr.push({ t, text }); };
  for (const o of ops) { if (o.t === '=') { push(L, '=', a[o.a]); push(R, '=', b[o.b]); } else if (o.t === '-') push(L, '-', a[o.a]); else push(R, '+', b[o.b]); }
  return { left: L, right: R };
}

/**
 * Compare two texts. rows: eq | del | add | mod (a paired replacement carrying word-level segments).
 * Throws RangeError for inputs over the limits.
 */
export function diffTexts(leftText, rightText, opts = {}) {
  const o = { ignoreWhitespace: !!opts.ignoreWhitespace, ignoreCase: !!opts.ignoreCase };
  if (String(leftText ?? '').length > LIMITS.text || String(rightText ?? '').length > LIMITS.text) throw new RangeError(`Each text must be ≤ ${LIMITS.text.toLocaleString('en-US')} characters`);
  const A = splitLines(leftText), B = splitLines(rightText);
  if (A.length > LIMITS.lines || B.length > LIMITS.lines) throw new RangeError(`Each text must be ≤ ${LIMITS.lines} lines`);
  let ops = myers(A.map((l) => norm(l, o)), B.map((l) => norm(l, o)), LIMITS.maxEdits), coarse = false;
  if (!ops) { coarse = true; ops = [...A.map((_, i) => ({ t: '-', a: i })), ...B.map((_, j) => ({ t: '+', b: j }))]; }
  const rows = []; let i = 0;
  while (i < ops.length) {
    if (ops[i].t === '=') { rows.push({ type: 'eq', left: { n: ops[i].a + 1, text: A[ops[i].a] }, right: { n: ops[i].b + 1, text: B[ops[i].b] } }); i++; continue; }
    const dels = [], adds = []; while (i < ops.length && ops[i].t !== '=') { (ops[i].t === '-' ? dels : adds).push(ops[i]); i++; }
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p++) { const l = A[dels[p].a], r = B[adds[p].b]; rows.push({ type: 'mod', left: { n: dels[p].a + 1, text: l }, right: { n: adds[p].b + 1, text: r }, words: wordDiff(l, r, o) }); }
    for (let p = pairs; p < dels.length; p++) rows.push({ type: 'del', left: { n: dels[p].a + 1, text: A[dels[p].a] }, right: null });
    for (let p = pairs; p < adds.length; p++) rows.push({ type: 'add', left: null, right: { n: adds[p].b + 1, text: B[adds[p].b] } });
  }
  const added = rows.filter((r) => r.type === 'add' || r.type === 'mod').length, removed = rows.filter((r) => r.type === 'del' || r.type === 'mod').length;
  return { rows, stats: { added, removed, changed: rows.filter((r) => r.type === 'mod').length, unchanged: rows.filter((r) => r.type === 'eq').length, identical: rows.every((r) => r.type === 'eq') }, coarse, leftLines: A.length, rightLines: B.length };
}

/** Unified diff text with `context` lines of context. */
export function unified(result, { leftName = 'a', rightName = 'b', context = 3 } = {}) {
  const flat = []; // expand mod rows to a '-' then '+' line, as `diff -u` prints them
  for (const r of result.rows) { if (r.type === 'eq') flat.push({ k: ' ', text: r.left.text, a: r.left.n, b: r.right.n }); else if (r.type === 'mod') flat.push({ k: '-', text: r.left.text, a: r.left.n }, { k: '+', text: r.right.text, b: r.right.n }); else if (r.type === 'del') flat.push({ k: '-', text: r.left.text, a: r.left.n }); else flat.push({ k: '+', text: r.right.text, b: r.right.n }); }
  // group by change blocks: a '-' run may be followed by a '+' run; reorder so all '-' come before '+' within a block (as diff -u does)
  const lines = []; for (let i = 0; i < flat.length;) { if (flat[i].k === ' ') { lines.push(flat[i++]); continue; } const m = [], p = []; while (i < flat.length && flat[i].k !== ' ') (flat[i].k === '-' ? m : p).push(flat[i++]); lines.push(...m, ...p); }
  const changeIdx = lines.map((l, i) => (l.k !== ' ' ? i : -1)).filter((i) => i >= 0);
  if (!changeIdx.length) return '';
  const hunks = []; let cur = null;
  for (const ci of changeIdx) { const from = Math.max(0, ci - context), to = Math.min(lines.length - 1, ci + context); if (cur && from <= cur.to + 1) cur.to = Math.max(cur.to, to); else { cur = { from, to }; hunks.push(cur); } }
  let out = `--- ${leftName}\n+++ ${rightName}\n`;
  for (const h of hunks) {
    const seg = lines.slice(h.from, h.to + 1), aCount = seg.filter((l) => l.k !== '+').length, bCount = seg.filter((l) => l.k !== '-').length;
    const aStart = aCount ? (seg.find((l) => l.a)?.a ?? 1) : (lines.slice(0, h.from).filter((l) => l.k !== '+').length), bStart = bCount ? (seg.find((l) => l.b)?.b ?? 1) : (lines.slice(0, h.from).filter((l) => l.k !== '-').length);
    out += `@@ -${aStart}${aCount === 1 ? '' : ',' + aCount} +${bStart}${bCount === 1 ? '' : ',' + bCount} @@\n` + seg.map((l) => l.k + l.text).join('\n') + '\n';
  }
  return out;
}
