// Pure colour maths (WCAG 2.x). Shared by server and browser.
const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', navy: '#000080', teal: '#008080', silver: '#c0c0c0', maroon: '#800000', lime: '#00ff00', aqua: '#00ffff', fuchsia: '#ff00ff', olive: '#808000', transparent: '#00000000' };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const byte = (s) => (s.endsWith('%') ? Math.round(clamp(parseFloat(s), 0, 100) * 2.55) : Math.round(clamp(parseFloat(s), 0, 255)));
const NUM = '(-?\\d*\\.?\\d+%?)';

/** Parse #rgb #rgba #rrggbb #rrggbbaa, rgb()/rgba(), hsl()/hsla() and a few names → {r,g,b,a} (0-255, a 0-1) or null. */
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase(); if (!s || s.length > 60) return null;
  if (NAMED[s]) s = NAMED[s];
  let m;
  if ((m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s))) {
    let h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? Math.round((parseInt(h.slice(6), 16) / 255) * 1000) / 1000 : 1 };
  }
  const alpha = (x) => (x == null ? 1 : x.endsWith('%') ? clamp(parseFloat(x) / 100, 0, 1) : clamp(parseFloat(x), 0, 1));
  if ((m = new RegExp(`^rgba?\\(\\s*${NUM}[\\s,]+${NUM}[\\s,]+${NUM}(?:\\s*[,/]\\s*${NUM})?\\s*\\)$`).exec(s))) return { r: byte(m[1]), g: byte(m[2]), b: byte(m[3]), a: alpha(m[4]) };
  if ((m = new RegExp(`^hsla?\\(\\s*(-?\\d*\\.?\\d+)(?:deg)?[\\s,]+${NUM}[\\s,]+${NUM}(?:\\s*[,/]\\s*${NUM})?\\s*\\)$`).exec(s))) {
    const rgb = hslToRgb(((parseFloat(m[1]) % 360) + 360) % 360, clamp(parseFloat(m[2]), 0, 100), clamp(parseFloat(m[3]), 0, 100)); return { ...rgb, a: alpha(m[4]) };
  }
  return null;
}
export function toHex({ r, g, b, a = 1 }) { const x = (n) => Math.round(n).toString(16).padStart(2, '0'); return '#' + x(r) + x(g) + x(b) + (a < 1 ? x(a * 255) : ''); }
export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: ((h * 60) + 360) % 360, s: s * 100, l: l * 100 };
}
export function hslToRgb(h, s, l) {
  s /= 100; l /= 100; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
export function luminance({ r, g, b }) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
/** Composite a (possibly translucent) colour over an opaque backdrop. */
export function over(fg, bg) { const a = fg.a ?? 1; return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }; }
/** Contrast ratio; a translucent foreground is composited over the background, a translucent background over white. */
export function contrast(fg, bg) {
  const back = (bg.a ?? 1) < 1 ? over(bg, { r: 255, g: 255, b: 255 }) : bg, top = over(fg, back), l1 = luminance(top), l2 = luminance(back);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/** WCAG thresholds. Ratios are compared unrounded, so 4.499 never passes as 4.5. */
export function grade(ratio) { return { aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, aaaLarge: ratio >= 4.5, ui: ratio >= 3 }; }
export const round2 = (n) => Math.floor(n * 100 + 1e-9) / 100;   // truncate, never round up: 4.499 is shown as 4.49

/** Nearest colour (same hue/saturation, only lightness changes) on the background that reaches `target`; null if impossible. */
export function suggest(fg, bg, target = 4.5) {
  const hsl = rgbToHsl(fg), at = (l) => ({ ...hslToRgb(hsl.h, hsl.s, l), a: 1 }), ok = (l) => contrast(at(l), bg) >= target;
  let best = null;
  for (const dir of [-1, 1]) {
    const end = dir < 0 ? 0 : 100; if (!ok(end)) continue;
    let lo = hsl.l, hi = end;   // invariant: ok(hi) true, search the closest-to-original lightness that passes
    if (ok(lo)) return { color: toHex({ ...at(hsl.l), a: fg.a }), ratio: contrast(at(hsl.l), bg), changed: false };
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
    // step to a whole-number RGB that still passes
    const c = at(hi); if (contrast(c, bg) < target) continue;
    const delta = Math.abs(hi - hsl.l); if (!best || delta < best.delta) best = { color: toHex(c), ratio: contrast(c, bg), delta, changed: true };
  }
  return best && { color: best.color, ratio: best.ratio, changed: best.changed };
}
