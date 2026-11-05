export interface Resolved { confidence: number; outcome: 0 | 1 }

/** Brier score: mean squared error of probability forecasts. 0 = perfect, 0.25 = always saying 50%. */
export function brierScore(items: Resolved[]): number | null {
  if (!items.length) return null;
  const sum = items.reduce((s, d) => s + (d.confidence / 100 - d.outcome) ** 2, 0);
  return sum / items.length;
}

export interface Bucket { label: string; from: number; to: number; count: number; hits: number; avgConfidence: number | null; hitRate: number | null }

/** Calibration buckets of width 20: 1-20, 21-40, 41-60, 61-80, 81-99. */
export function calibration(items: Resolved[]): Bucket[] {
  const ranges: [number, number][] = [[1, 20], [21, 40], [41, 60], [61, 80], [81, 99]];
  return ranges.map(([from, to]) => {
    const inB = items.filter((d) => d.confidence >= from && d.confidence <= to);
    const hits = inB.filter((d) => d.outcome === 1).length;
    return {
      label: `${from}–${to}%`, from, to, count: inB.length, hits,
      avgConfidence: inB.length ? inB.reduce((s, d) => s + d.confidence, 0) / inB.length : null,
      hitRate: inB.length ? (hits / inB.length) * 100 : null,
    };
  });
}

/** Positive = overconfident, negative = underconfident (avg confidence minus hit rate, in points). */
export function overconfidence(items: Resolved[]): number | null {
  if (!items.length) return null;
  const avg = items.reduce((s, d) => s + d.confidence, 0) / items.length;
  const rate = (items.filter((d) => d.outcome === 1).length / items.length) * 100;
  return avg - rate;
}
