// Pure helpers: FTS query building and snippet validation.
export const LIMITS = { title: 120, code: 50_000, notes: 5_000, tag: 24, tags: 8, language: 20, import: 500 };
// Strip control chars except \t \n \r (also removes the \u0001/\u0002 markers used for highlighting).
export const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

/** Turn free text into a safe FTS5 query: every word becomes a quoted prefix term, AND-ed. Returns null if nothing searchable. */
export function toFtsQuery(input) {
  const words = String(input ?? '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
  return words.length ? words.slice(0, 8).map((w) => `"${w.replaceAll('"', '""')}"*`).join(' ') : null;
}
export function normalizeTags(v) {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(',');
  const out = [];
  for (const t of arr) { const x = clean(String(t)).trim().toLowerCase().replace(/\s+/g, '-').slice(0, LIMITS.tag); if (x && !out.includes(x)) out.push(x); }
  return out.slice(0, LIMITS.tags);
}
/** Returns {value} or {errors}. */
export function validateSnippet(b) {
  const errors = {}; b = b && typeof b === 'object' ? b : {};
  const title = typeof b.title === 'string' ? clean(b.title).trim() : '';
  const code = typeof b.code === 'string' ? clean(b.code).replace(/\s+$/, '') : '';
  const notes = typeof b.notes === 'string' ? clean(b.notes).trim() : '';
  const language = (typeof b.language === 'string' && b.language.trim() ? b.language : 'text').trim().toLowerCase();
  if (!title) errors.title = 'Title is required'; else if (title.length > LIMITS.title) errors.title = `Title must be ≤ ${LIMITS.title} characters`;
  if (!code.trim()) errors.code = 'Code is required'; else if (code.length > LIMITS.code) errors.code = `Code must be ≤ ${LIMITS.code} characters`;
  if (notes.length > LIMITS.notes) errors.notes = `Notes must be ≤ ${LIMITS.notes} characters`;
  if (!/^[a-z0-9+#.\-]{1,20}$/.test(language)) errors.language = 'Language must be 1–20 letters, digits or + # . -';
  if (Object.keys(errors).length) return { errors };
  return { value: { title, code, notes, language, tags: normalizeTags(b.tags) } };
}
/** Render a snippet() result containing \u0001..\u0002 markers into [{text, hit}] parts. */
export function splitHighlight(s) {
  const parts = []; let hit = false, buf = '';
  for (const ch of String(s)) {
    if (ch === '\u0001' || ch === '\u0002') { if (buf) parts.push({ text: buf, hit }); buf = ''; hit = ch === '\u0001'; } else buf += ch;
  }
  if (buf) parts.push({ text: buf, hit });
  return parts;
}
