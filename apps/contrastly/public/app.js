import { parseColor, toHex, contrast, grade, round2, suggest } from '/color.js';
const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.details = j?.details; throw e; } return j;
}
const level = (r) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA Large' : 'Fail');
const swatch = (hex) => { const s = h('span', { class: 'swatch', role: 'img', 'aria-label': hex }); s.style.background = hex; return s; };

function checkerView(sp) {
  const fgIn = h('input', { id: 'fg', value: sp.get('fg') || '#767676', 'aria-label': 'Text colour', spellcheck: 'false' }), bgIn = h('input', { id: 'bg', value: sp.get('bg') || '#ffffff', 'aria-label': 'Background colour', spellcheck: 'false' });
  const fgPick = h('input', { type: 'color', 'aria-label': 'Pick text colour' }), bgPick = h('input', { type: 'color', 'aria-label': 'Pick background colour' });
  const out = h('div', { id: 'result' }), prev = h('div', { class: 'preview', id: 'sample' }, h('p', { class: 'big' }, 'Large text sample (24px bold)'), h('p', { class: 'sm' }, 'Normal body text sample — the quick brown fox jumps over the lazy dog.'));
  const badge = (label, ok) => h('span', { class: 'badge ' + (ok ? 'pass' : 'fail'), 'data-badge': label }, `${label}: ${ok ? 'Pass' : 'Fail'}`);
  const sugRow = (label, target, fg, bg) => { const s = suggest(fg, bg, target); return h('p', { 'data-suggest': label }, `${label} (${target}:1): `, s ? [swatch(s.color), ' ', h('code', null, s.color), ` → ${round2(s.ratio)}:1 `, h('button', { type: 'button', onclick: () => { fgIn.value = s.color; update(); } }, 'Use this')] : 'not reachable by changing the text colour alone — change the background too.'); };
  const update = () => {
    const fg = parseColor(fgIn.value), bg = parseColor(bgIn.value); fgIn.setAttribute('aria-invalid', String(!fg)); bgIn.setAttribute('aria-invalid', String(!bg)); out.replaceChildren();
    if (!fg || !bg) { add(out, [h('p', { class: 'err', id: 'bad-input' }, `${!fg ? 'Text' : 'Background'} colour isn’t recognised — try #1a2b3c, rgb(26 43 60) or hsl(210 40% 17%).`)]); return; }
    const opaque = (c) => ({ ...c, a: 1 }); fgPick.value = toHex(opaque(fg)); bgPick.value = toHex(opaque(bg));
    const back = bg.a < 1 ? { r: 255, g: 255, b: 255 } : bg; const shown = bg.a < 1 ? { r: bg.r * bg.a + 255 * (1 - bg.a), g: bg.g * bg.a + 255 * (1 - bg.a), b: bg.b * bg.a + 255 * (1 - bg.a) } : bg;
    prev.style.background = toHex(opaque({ r: Math.round(shown.r), g: Math.round(shown.g), b: Math.round(shown.b) })); prev.style.color = fgIn.value.trim();
    const r = contrast(fg, bg), g = grade(r);
    add(out, [h('p', { class: 'ratio', id: 'ratio' }, `${round2(r)}:1`), h('p', { class: 'meta', id: 'level' }, level(r)), h('div', { class: 'badges' }, badge('AA normal', g.aaNormal), badge('AA large', g.aaLarge), badge('AAA normal', g.aaaNormal), badge('AAA large', g.aaaLarge), badge('UI components', g.ui)),
      !g.aaNormal ? sugRow('Nearest AA', 4.5, fg, bg) : null, !g.aaaNormal ? sugRow('Nearest AAA', 7, fg, bg) : null,
      h('p', null, h('button', { type: 'button', id: 'swap', onclick: () => { [fgIn.value, bgIn.value] = [bgIn.value, fgIn.value]; update(); } }, 'Swap'))]);
    history.replaceState(null, '', `#/?fg=${encodeURIComponent(fgIn.value.trim())}&bg=${encodeURIComponent(bgIn.value.trim())}`);
  };
  for (const el of [fgIn, bgIn]) el.addEventListener('input', update); fgPick.addEventListener('input', () => { fgIn.value = fgPick.value; update(); }); bgPick.addEventListener('input', () => { bgIn.value = bgPick.value; update(); });
  render(h('h1', null, 'Contrast checker'), h('div', { class: 'grid' }, h('div', null, h('label', { for: 'fg' }, 'Text colour'), h('div', { class: 'row' }, fgIn, fgPick), h('label', { for: 'bg' }, 'Background'), h('div', { class: 'row' }, bgIn, bgPick), prev), out)); update();
}

async function palettesView() {
  const list = await api('GET', '/palettes'); const name = h('input', { id: 'pname', maxlength: 60, placeholder: 'Palette name' }), colors = h('input', { id: 'pcolors', placeholder: '#1a2b3c, #ffffff, rgb(200 30 30)', 'aria-label': 'Colours, comma separated' }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
  const split = (s) => s.split(/,(?![^()]*\))/).map((x) => x.trim()).filter(Boolean);   // commas inside rgb()/hsl() don't split
  const save = async (e) => { e.preventDefault(); err.textContent = ''; try { const p = await api('POST', '/palettes', { name: name.value, colors: split(colors.value) }); location.hash = `#/palettes/${p.id}`; } catch (er) { err.textContent = er.details ? Object.values(er.details).join(' · ') : er.message; } };
  render(h('h1', null, 'Palettes'), h('form', { onsubmit: save, class: 'card' }, h('label', { for: 'pname' }, 'Save a palette'), h('div', { class: 'row' }, name, colors, h('button', { class: 'primary' }, 'Save')), err),
    list.length ? list.map((p) => h('a', { class: 'card', href: `#/palettes/${p.id}`, 'data-palette': p.id }, h('strong', null, p.name), ' ', p.colors.map(swatch))) : h('p', { class: 'empty' }, 'No palettes yet.'));
}
async function matrixView(id) {
  const m = await api('GET', `/palettes/${id}/matrix`), n = m.colors.length;
  const head = h('tr', null, h('th', null, 'text ↓ / bg →'), m.colors.map((c) => h('th', null, swatch(c), ' ', c)));
  const rows = m.colors.map((fg, i) => h('tr', null, h('th', null, swatch(fg), ' ', fg), m.colors.map((bg, j) => { const c = m.cells[i * n + j]; return c ? h('td', { 'data-pair': `${c.fg}/${c.bg}`, class: 'lv-' + c.level.replace(' ', '') }, h('div', null, `${c.ratio}:1`), h('div', null, c.level)) : h('td', null, '—'); })));
  render(h('h1', null, m.name), h('p', { class: 'meta', id: 'summary' }, `${m.summary.belowAA} of ${m.summary.pairs} text/background pairs are below AA (4.5:1)`), h('div', { class: 'scroll' }, h('table', { class: 'matrix' }, head, rows)),
    h('p', null, h('a', { href: '#/palettes' }, '← All palettes'), ' ', h('button', { class: 'danger', id: 'delete', onclick: async () => { if (!confirm('Delete this palette?')) return; await api('DELETE', `/palettes/${id}`); location.hash = '#/palettes'; } }, 'Delete')));
}

let routing = Promise.resolve();
async function doRoute() {
  const [path, qs] = location.hash.slice(1).split('?'), parts = path.split('/').filter(Boolean), sp = new URLSearchParams(qs || '');
  document.getElementById('nav-check').removeAttribute('aria-current'); document.getElementById('nav-pal').removeAttribute('aria-current');
  try {
    if (!parts.length) { document.getElementById('nav-check').setAttribute('aria-current', 'page'); checkerView(sp); }
    else if (parts[0] === 'palettes') { document.getElementById('nav-pal').setAttribute('aria-current', 'page'); if (parts[1]) await matrixView(Number(parts[1])); else await palettesView(); }
    else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back to the checker'));
  } catch (e) { render(h('h1', null, 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
