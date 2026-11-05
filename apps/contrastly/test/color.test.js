import test from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, toHex, contrast, grade, round2, suggest, rgbToHsl, hslToRgb, luminance } from '../src/color.js';
const c = (s) => parseColor(s);

test('parseColor: hex forms, functional forms, names; rejects junk', () => {
  assert.deepEqual(c('#fff'), { r: 255, g: 255, b: 255, a: 1 }); assert.deepEqual(c('#F0a8'), { r: 255, g: 0, b: 170, a: 0.533 }); assert.deepEqual(c(' #336699 '), { r: 51, g: 102, b: 153, a: 1 }); assert.equal(c('#33669980').a, 0.502);
  assert.deepEqual(c('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30, a: 1 }); assert.deepEqual(c('rgb(10 20 30 / 50%)'), { r: 10, g: 20, b: 30, a: 0.5 }); assert.deepEqual(c('rgba(100%, 0%, 0%, .25)'), { r: 255, g: 0, b: 0, a: 0.25 }); assert.deepEqual(c('rgb(300, -5, 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(c('hsl(120, 100%, 25%)'), { r: 0, g: 128, b: 0, a: 1 }); assert.deepEqual(c('hsl(-120 100% 50%)'), { r: 0, g: 0, b: 255, a: 1 }); assert.equal(c('Navy').b, 128); assert.equal(c('transparent').a, 0);
  for (const bad of ['', '#12', '#12345', '#gggggg', 'rgb(1,2)', 'blurple', 'rgb(1,2,3', null, 42, 'x'.repeat(100)]) assert.equal(c(bad), null, String(bad));
});
test('toHex / hsl round trips', () => {
  assert.equal(toHex({ r: 255, g: 0, b: 170, a: 1 }), '#ff00aa'); assert.equal(toHex({ r: 0, g: 0, b: 0, a: 0.5 }), '#00000080');
  for (const hex of ['#336699', '#ff8800', '#808080', '#0a0a0a', '#fafafa']) { const o = c(hex), { h, s, l } = rgbToHsl(o); assert.equal(toHex(hslToRgb(h, s, l)), hex); }
});
test('WCAG reference values', () => {
  assert.equal(luminance(c('#fff')), 1); assert.equal(luminance(c('#000')), 0);
  assert.equal(contrast(c('#000'), c('#fff')), 21); assert.equal(contrast(c('#fff'), c('#fff')), 1); assert.equal(contrast(c('#fff'), c('#000')), 21, 'symmetric');
  assert.equal(round2(contrast(c('#767676'), c('#fff'))), 4.54); assert.equal(round2(contrast(c('#777'), c('#fff'))), 4.47, '#777 on white is 4.48 rounded but must not pass AA... and truncates to 4.47');
  assert.equal(grade(contrast(c('#767676'), c('#fff'))).aaNormal, true); assert.equal(grade(contrast(c('#777'), c('#fff'))).aaNormal, false);
  assert.equal(round2(contrast(c('#ff0000'), c('#fff'))), 3.99); assert.equal(round2(contrast(c('#0000ff'), c('#fff'))), 8.59);
});
test('grade thresholds are inclusive and unrounded', () => {
  assert.deepEqual(grade(21), { aaNormal: true, aaLarge: true, aaaNormal: true, aaaLarge: true, ui: true }); assert.deepEqual(grade(4.5), { aaNormal: true, aaLarge: true, aaaNormal: false, aaaLarge: true, ui: true }); assert.deepEqual(grade(4.4999), { aaNormal: false, aaLarge: true, aaaNormal: false, aaaLarge: false, ui: true }); assert.deepEqual(grade(2.99), { aaNormal: false, aaLarge: false, aaaNormal: false, aaaLarge: false, ui: false });
  assert.equal(round2(4.499), 4.49); assert.equal(round2(7), 7);
});
test('translucent colours are composited (fg over bg, bg over white)', () => {
  assert.equal(contrast(c('#00000000'), c('#fff')), 1, 'fully transparent fg = background'); const half = contrast(c('rgba(0,0,0,.5)'), c('#fff')); assert.ok(half > 3.9 && half < 4.3, String(half)); assert.equal(contrast(c('#000'), c('rgba(255,255,255,0)')), 21, 'transparent bg is treated as white');
});
test('suggest: keeps hue, reaches target with minimal lightness change, exact boundary passes', () => {
  assert.equal(suggest(c('#000'), c('#fff')).changed, false);
  for (const [fg, bg, t] of [['#777777', '#ffffff', 4.5], ['#aaaaaa', '#ffffff', 7], ['#336699', '#223344', 4.5], ['#ffcc00', '#ffffff', 4.5], ['#999', '#888', 3], ['#ff0000', '#ff3333', 4.5]]) {
    const s = suggest(c(fg), c(bg), t); assert.ok(s, `${fg}/${bg}`); assert.ok(contrast(c(s.color), c(bg)) >= t, `${fg} on ${bg} → ${s.color} (${s.ratio})`); assert.ok(s.ratio >= t);
  }
  const s = suggest(c('#777777'), c('#ffffff')); assert.ok(c(s.color).r < 0x77 && c(s.color).r >= 0x70, 'darkens just enough: ' + s.color); assert.equal(s.color, '#767676');
  const warm = c(suggest(c('#ffcc00'), c('#ffffff')).color), h0 = rgbToHsl(c('#ffcc00')).h, h1 = rgbToHsl(warm).h; assert.ok(Math.abs(h0 - h1) < 3, `hue kept ${h0} → ${h1}`);
  assert.equal(suggest(c('#888'), c('#777777'), 7), null, 'target 7 on a mid-grey background is impossible');
});
