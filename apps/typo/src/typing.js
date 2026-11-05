// Pure typing-test maths shared by browser, server and tests.
export const LIMITS = { maxCpm: 1500, minMsPerChar: 25, maxChars: 400, maxMs: 30 * 60_000 };   // 1500 chars/min = 300 wpm: faster than any human

/** Per-character state of what has been typed so far vs the target: 'ok' | 'bad' | 'pending'. */
export function charStates(target, typed) { return [...target].map((c, i) => (i >= typed.length ? 'pending' : typed[i] === c ? 'ok' : 'bad')); }

/** WPM (5 chars = 1 word), raw WPM and keystroke accuracy from plain numbers. */
export function computeStats({ ms, typed, correct, keystrokes, wrongKeystrokes }) {
  const minutes = ms > 0 ? ms / 60000 : 0, r1 = (n) => Math.round(n * 10) / 10;
  return { wpm: minutes ? r1((correct / 5) / minutes) : 0, rawWpm: minutes ? r1((typed / 5) / minutes) : 0, accuracy: keystrokes ? r1(((keystrokes - wrongKeystrokes) / keystrokes) * 100) : 100 };
}
/** Final or live statistics. `ms` is the elapsed time between the first and last keystroke. */
export function analyze(target, typed, ms, extra = {}) {
  const t = [...target], y = [...typed], n = Math.min(t.length, y.length);
  let correct = 0; for (let i = 0; i < n; i++) if (y[i] === t[i]) correct++;
  const uncorrected = y.length - correct, keystrokes = extra.keystrokes ?? y.length, wrongKeystrokes = extra.wrongKeystrokes ?? uncorrected;
  return { typed: y.length, correct, uncorrected, ...computeStats({ ms, typed: y.length, correct, keystrokes, wrongKeystrokes }), ms, complete: y.length >= t.length && uncorrected === 0 };
}
/** Expected characters that were typed wrongly, counted per expected char: {"e": 2, " ": 1}. */
export function mistakeMap(events) { const m = {}; for (const e of events) if (!e.ok) m[e.expected] = (m[e.expected] || 0) + 1; return m; }

/** Server-side validation of a submitted result. Returns {value} or {errors}. */
export function validateResult(b, passage) {
  const errors = {}; b = b && typeof b === 'object' ? b : {}; const total = [...passage.text].length;
  const num = (k, lo, hi) => { const v = b[k]; if (!Number.isInteger(v) || v < lo || v > hi) { errors[k] = `${k} must be a whole number from ${lo} to ${hi}`; return null; } return v; };
  const ms = num('durationMs', 1, LIMITS.maxMs), typed = num('typedChars', 1, LIMITS.maxChars), correct = num('correctChars', 0, LIMITS.maxChars), keys = num('keystrokes', 1, LIMITS.maxChars * 4), wrong = num('wrongKeystrokes', 0, LIMITS.maxChars * 4);
  if (!Object.keys(errors).length) {
    if (correct > typed) errors.correctChars = 'correctChars cannot exceed typedChars'; if (typed > total) errors.typedChars = 'typedChars cannot exceed the passage length'; if (wrong > keys) errors.wrongKeystrokes = 'wrongKeystrokes cannot exceed keystrokes';
    if (keys < typed - 0) errors.keystrokes = 'keystrokes cannot be fewer than typed characters';
    if (!errors.typedChars && !errors.keystrokes && (ms < keys * LIMITS.minMsPerChar || (keys / (ms / 60000)) > LIMITS.maxCpm)) errors.durationMs = 'That speed is not humanly possible — result rejected';
  }
  const mist = {}; if (b.mistakes != null) { if (typeof b.mistakes !== 'object' || Array.isArray(b.mistakes)) errors.mistakes = 'mistakes must be an object'; else for (const [k, v] of Object.entries(b.mistakes)) { if ([...k].length !== 1 || !Number.isInteger(v) || v < 1 || v > 1000) { errors.mistakes = 'mistakes must map single characters to counts'; break; } mist[k] = v; } }
  if (Object.keys(errors).length) return { errors };
  return { value: { durationMs: ms, typedChars: typed, correctChars: correct, keystrokes: keys, wrongKeystrokes: wrong, mistakes: mist, ...computeStats({ ms, typed, correct, keystrokes: keys, wrongKeystrokes: wrong }) } };
}

/** Top mistaken characters across results ([{ch, count}]). */
export function weakKeys(results, n = 5) { const m = {}; for (const r of results) for (const [k, v] of Object.entries(r.mistakes || {})) m[k] = (m[k] || 0) + v; return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([ch, count]) => ({ ch, count })); }
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** Consecutive practice days ending today (or yesterday: grace day). */
export function dayStreak(days, today) { const s = new Set(days); let d = s.has(today) ? today : addDays(today, -1), n = 0; while (s.has(d)) { n++; d = addDays(d, -1); } return n; }
