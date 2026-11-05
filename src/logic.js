// Pure business logic: validation and calibration statistics.
export const OUTCOMES = { hit: 1, partial: 0.5, miss: 0 };
const MAX = { title: 200, text: 5000, tag: 30 };

const isDate = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };

export function normalizeTags(tags) {
  const arr = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
  const out = [];
  for (const t of arr) {
    const v = String(t).trim().toLowerCase().slice(0, MAX.tag);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 10);
}

/** Validate create/update payload. Returns { value } or { errors }. */
export function validateDecision(input, today = new Date().toISOString().slice(0, 10)) {
  const errors = {};
  const b = input && typeof input === 'object' ? input : {};
  const str = (k) => (typeof b[k] === 'string' ? b[k].trim() : '');
  const title = str('title');
  if (!title) errors.title = 'Title is required';
  else if (title.length > MAX.title) errors.title = `Title must be ≤ ${MAX.title} characters`;
  for (const k of ['context', 'choice', 'prediction']) {
    if (str(k).length > MAX.text) errors[k] = `Too long (max ${MAX.text})`;
  }
  if (!str('prediction')) errors.prediction = 'State what you expect to happen';
  const confidence = Number(b.confidence);
  if (!Number.isInteger(confidence) || confidence < 50 || confidence > 99)
    errors.confidence = 'Confidence must be a whole number from 50 to 99';
  const decidedAt = b.decidedAt || today;
  if (!isDate(decidedAt)) errors.decidedAt = 'Invalid date (YYYY-MM-DD)';
  const reviewOn = b.reviewOn;
  if (!isDate(reviewOn)) errors.reviewOn = 'Pick a review date';
  else if (isDate(decidedAt) && reviewOn < decidedAt) errors.reviewOn = 'Review date cannot be before decision date';
  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      title, context: str('context'), choice: str('choice'), prediction: str('prediction'),
      confidence, decidedAt, reviewOn, tags: normalizeTags(b.tags),
    },
  };
}

export function validateReview(input) {
  const b = input && typeof input === 'object' ? input : {};
  const errors = {};
  if (!(b.outcome in OUTCOMES)) errors.outcome = 'Outcome must be hit, partial or miss';
  const note = typeof b.outcomeNote === 'string' ? b.outcomeNote.trim() : '';
  if (note.length > MAX.text) errors.outcomeNote = `Too long (max ${MAX.text})`;
  if (Object.keys(errors).length) return { errors };
  return { value: { outcome: b.outcome, outcomeNote: note } };
}

/** Calibration stats over reviewed decisions. */
export function computeStats(decisions) {
  const reviewed = decisions.filter((d) => d.status === 'reviewed' && d.outcome in OUTCOMES);
  const buckets = [];
  for (let lo = 50; lo < 100; lo += 10) {
    const items = reviewed.filter((d) => d.confidence >= lo && d.confidence < lo + 10);
    const n = items.length;
    buckets.push({
      range: `${lo}–${lo + 9}`, lo, count: n,
      avgConfidence: n ? round(items.reduce((s, d) => s + d.confidence, 0) / n) : null,
      hitRate: n ? round((items.reduce((s, d) => s + OUTCOMES[d.outcome], 0) / n) * 100) : null,
    });
  }
  const n = reviewed.length;
  const brier = n ? round(reviewed.reduce((s, d) => s + (d.confidence / 100 - OUTCOMES[d.outcome]) ** 2, 0) / n, 3) : null;
  const avgConf = n ? round(reviewed.reduce((s, d) => s + d.confidence, 0) / n) : null;
  const hitRate = n ? round((reviewed.reduce((s, d) => s + OUTCOMES[d.outcome], 0) / n) * 100) : null;
  let verdict = null;
  if (n >= 5) {
    const gap = avgConf - hitRate;
    verdict = Math.abs(gap) <= 5 ? 'well-calibrated' : gap > 0 ? 'overconfident' : 'underconfident';
  }
  return {
    total: decisions.length, open: decisions.length - n, reviewed: n,
    avgConfidence: avgConf, hitRate, brier, verdict, buckets,
  };
}

function round(x, p = 1) { const m = 10 ** p; return Math.round(x * m) / m; }
