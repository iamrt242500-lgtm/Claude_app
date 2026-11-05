// Wiki-link extraction and renaming; ignores code spans and fenced code blocks.
export const TITLE_MAX = 100;
const WIKI = /\[\[([^\[\]|\n]{1,100})(?:\|([^\[\]\n]{0,100}))?\]\]/g;
const key = (t) => t.trim().toLowerCase();

/** Apply fn only to text outside fenced code blocks and inline code spans. */
export function mapOutsideCode(body, fn) {
  return String(body).split(/(```[\s\S]*?```|`[^`\n]+`)/g).map((seg, i) => (i % 2 ? seg : fn(seg))).join('');
}
/** Unique lowercase link targets in order of appearance. */
export function extractLinks(body) {
  const out = [];
  mapOutsideCode(body, (seg) => { for (const m of seg.matchAll(WIKI)) { const k = key(m[1]); if (k && !out.includes(k)) out.push(k); } return seg; });
  return out;
}
/** Rewrite [[old]] / [[old|label]] to the new title (case-insensitive), keeping labels. */
export function renameLinks(body, oldTitle, newTitle) {
  const o = key(oldTitle);
  return mapOutsideCode(body, (seg) => seg.replace(WIKI, (all, t, label) => (key(t) === o ? `[[${newTitle}${label !== undefined ? '|' + label : ''}]]` : all)));
}
export function toFtsQuery(input) {
  const words = String(input ?? '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
  return words.length ? words.slice(0, 8).map((w) => `"${w.replaceAll('"', '""')}"*`).join(' ') : null;
}
export const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
export function validateNote(b) {
  const errors = {}; b = b && typeof b === 'object' ? b : {};
  const title = typeof b.title === 'string' ? clean(b.title).trim().replace(/\s+/g, ' ') : '';
  const body = typeof b.body === 'string' ? clean(b.body) : '';
  if (!title) errors.title = 'Title is required'; else if (title.length > TITLE_MAX) errors.title = `Title must be ≤ ${TITLE_MAX} characters`;
  else if (/[\[\]|]/.test(title)) errors.title = 'Title cannot contain [ ] or |';
  if (body.length > 100_000) errors.body = 'Note is too long (max 100,000 characters)';
  if (Object.keys(errors).length) return { errors };
  return { value: { title, body } };
}
