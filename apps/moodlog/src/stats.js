// Statistics for the mood journal. Pure; shared by server and browser.
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** Pearson r, or null when undefined (n < 3 or zero variance). */
export function pearson(xs, ys) {
  const n = xs.length; if (n < 3 || n !== ys.length) return null; const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null; return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}
/** Plain-language strength label for |r|. */
export function strength(r) { if (r == null) return 'not enough data'; const a = Math.abs(r), s = a < 0.2 ? 'no clear' : a < 0.4 ? 'weak' : a < 0.7 ? 'moderate' : 'strong'; return s === 'no clear' ? s + ' link' : `${s} ${r > 0 ? 'positive' : 'negative'} link`; }
/** Trailing moving average (window w); null until w points exist. */
export function movingAverage(xs, w) { return xs.map((_, i) => (i + 1 < w ? null : mean(xs.slice(i + 1 - w, i + 1)))); }
/**
 * For each tag: average mood on days WITH the tag vs days WITHOUT, and the difference. Tags seen on fewer than `min` days are skipped.
 * entries: [{ mood, tags: [] }]
 */
export function tagEffects(entries, min = 3) {
  const all = new Set(entries.flatMap((e) => e.tags)), out = [];
  for (const tag of all) {
    const w = entries.filter((e) => e.tags.includes(tag)).map((e) => e.mood), wo = entries.filter((e) => !e.tags.includes(tag)).map((e) => e.mood);
    if (w.length < min || wo.length < min) continue; out.push({ tag, days: w.length, withTag: mean(w), without: mean(wo), diff: mean(w) - mean(wo) });
  }
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.tag.localeCompare(b.tag));
}
/** Average mood by weekday (0=Sun..6=Sat) for YYYY-MM-DD dates. */
export function byWeekday(entries) {
  const buckets = Array.from({ length: 7 }, () => []); for (const e of entries) buckets[new Date(e.day + 'T00:00:00Z').getUTCDay()].push(e.mood);
  return buckets.map((b) => ({ n: b.length, avg: mean(b) }));
}
