import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
export const LIMITS = { question: 200, option: 100, options: [2, 10], expiryDays: 365 };
export const MODES = ['always', 'after_vote', 'after_close'];

export const newToken = (bytes = 16) => randomBytes(bytes).toString('base64url');
export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');
export const tokenMatches = (token, hash) => { const a = Buffer.from(hashToken(token)), b = Buffer.from(String(hash)); return a.length === b.length && timingSafeEqual(a, b); };
export const isToken = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s);

/** {value} or {errors}. `now` is epoch ms (for validating the close time). */
export function validatePoll(b, now) {
  const errors = {}; b = b && typeof b === 'object' ? b : {};
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!question) errors.question = 'Question is required'; else if (question.length > LIMITS.question) errors.question = `Question must be ≤ ${LIMITS.question} characters`;
  const raw = Array.isArray(b.options) ? b.options.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean) : [];
  if (raw.length < LIMITS.options[0]) errors.options = `Add at least ${LIMITS.options[0]} options`;
  else if (raw.length > LIMITS.options[1]) errors.options = `At most ${LIMITS.options[1]} options`;
  else if (raw.some((o) => o.length > LIMITS.option)) errors.options = `Options must be ≤ ${LIMITS.option} characters`;
  else if (new Set(raw.map((o) => o.toLowerCase())).size !== raw.length) errors.options = 'Options must be different from each other';
  const mode = b.resultsMode ?? 'always'; if (!MODES.includes(mode)) errors.resultsMode = 'Invalid results setting';
  let closesAt = null;
  if (b.closesAt != null && b.closesAt !== '') {
    const t = typeof b.closesAt === 'string' ? Date.parse(b.closesAt) : NaN;
    if (Number.isNaN(t)) errors.closesAt = 'Invalid closing time'; else if (t <= now) errors.closesAt = 'Closing time must be in the future'; else if (t > now + LIMITS.expiryDays * 86400000) errors.closesAt = `Closing time must be within ${LIMITS.expiryDays} days`; else closesAt = new Date(t).toISOString();
  }
  if (Object.keys(errors).length) return { errors };
  return { value: { question, options: raw, multi: !!b.multi, resultsMode: mode, closesAt } };
}
export const isClosed = (poll, now) => !!poll.closed || (!!poll.closesAt && Date.parse(poll.closesAt) <= now);
/** Counts are shown only when the poll's results policy allows it for this viewer. */
export function canSeeResults(mode, { hasVoted, closed, isAdmin }) { return isAdmin || mode === 'always' || (mode === 'after_vote' && (hasVoted || closed)) || (mode === 'after_close' && closed); }
export function tally(optionIds, votes) { const c = Object.fromEntries(optionIds.map((id) => [id, 0])); for (const v of votes) if (v in c) c[v]++; return c; }
/** Validate chosen option ids against the poll. Returns {ids} or {error}. */
export function validateChoice(poll, ids) {
  if (!Array.isArray(ids)) return { error: 'options must be a list of option ids' };
  const uniq = [...new Set(ids)]; if (uniq.some((i) => !Number.isInteger(i))) return { error: 'options must be a list of option ids' };
  if (!uniq.length) return { error: 'Choose at least one option' };
  if (uniq.some((i) => !poll.optionIds.includes(i))) return { error: 'Unknown option' };
  if (!poll.multi && uniq.length !== 1) return { error: 'Choose exactly one option' };
  return { ids: uniq };
}
/** Fixed-window-per-key limiter with an injectable clock. */
export function createLimiter(limit, windowMs, now = Date.now) {
  const hits = new Map();
  return (key) => { const t = now(), e = hits.get(key); if (!e || t - e.start >= windowMs) { hits.set(key, { start: t, n: 1 }); if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k); return { ok: true }; } e.n++; return e.n <= limit ? { ok: true } : { ok: false, retryAfter: Math.ceil((e.start + windowMs - t) / 1000) }; };
}
