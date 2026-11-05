import { randomInt } from 'node:crypto';
export const RESERVED = new Set(['api', 's', 'admin', 'static', 'assets', 'app', 'favicon.ico', 'index.html', 'styles.css', 'app.js']);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';   // no look-alikes (0/O, 1/l/I)
export const generateCode = (len = 6) => Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** Returns {value: normalizedUrl} or {error}. Only http(s), no credentials, bounded length; refuses redirect loops back to `ownHost`. */
export function validateUrl(input, ownHost = '') {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { error: 'URL is required' };
  if (raw.length > 2048) return { error: 'URL is too long (max 2048 characters)' };
  let u; try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw); } catch { return { error: 'That does not look like a valid URL' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { error: 'Only http and https links are allowed' };
  if (u.username || u.password) return { error: 'URLs with embedded credentials are not allowed' };
  if (!u.hostname || !(u.hostname.includes('.') || u.hostname === 'localhost' || /^\[.*\]$/.test(u.hostname))) return { error: 'That does not look like a valid URL' };
  if (ownHost && u.host.toLowerCase() === ownHost.toLowerCase()) return { error: 'Links to this service itself are not allowed' };
  return { value: u.href };
}
export function validateSlug(input) {
  if (input == null || input === '') return { value: null };
  const s = String(input).trim();
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(s)) return { error: 'Custom slug must be 3–32 letters, digits, - or _' };
  if (RESERVED.has(s.toLowerCase())) return { error: 'That slug is reserved' };
  return { value: s };
}
const isValidDate = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
export function validateExpiry(input, today) {
  if (input == null || input === '') return { value: null };
  if (!isValidDate(input)) return { error: 'Invalid expiry date' };
  if (input < today) return { error: 'Expiry date cannot be in the past' };
  return { value: input };
}
export const classifyUa = (ua = '') => /bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget|python-requests|headless/i.test(ua) ? 'bot' : /mobile|android|iphone|ipad/i.test(ua) ? 'mobile' : ua ? 'desktop' : 'unknown';
export function referrerHost(ref) { try { const h = new URL(ref).hostname.replace(/^www\./, '').toLowerCase(); return h || null; } catch { return null; } }
export const isExpired = (expiresOn, today) => !!expiresOn && expiresOn < today;
