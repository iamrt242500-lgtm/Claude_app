import { diffTexts, unified, LIMITS } from './diff.js';
const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const toast = (m, t = '') => { const e = h('div', { class: 'toast ' + t }, m); $('#toasts').append(e); setTimeout(() => e.remove(), 3500); };
class ApiError extends Error { constructor(m, d, s) { super(m); this.details = d; this.status = s; } }
async function api(path, opts = {}) {
  let res;
  try { res = await fetch('/api' + path, { method: opts.method, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new ApiError('Network error — check your connection and try again.', null, 0); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, data.details, res.status);
  return data;
}
async function copy(text, msg) { try { await navigator.clipboard.writeText(text); toast(msg); } catch { const t = h('textarea', { 'aria-hidden': 'true' }, text); document.body.append(t); t.select(); try { document.execCommand('copy') ? toast(msg) : toast('Copy failed', 'error'); } finally { t.remove(); } } }

const st = { left: '', right: '', ws: false, cs: false, view: 'side', onlyChanges: false, saved: [] };
const words = (segs, cls) => segs.map((s) => (s.t === '=' ? s.text : h('mark', { class: cls }, s.text)));
const cell = (n, text, extra) => [h('td', { class: 'n' }, n == null ? '' : String(n)), extra ?? null, h('td', { class: 't' }, text)];

function renderSide(rows) {
  return h('table', { class: 'd side', 'aria-label': 'Side-by-side diff' }, h('tbody', {}, rows.map((r) => {
    if (r.type === 'eq') return h('tr', { class: 'eq' }, h('td', { class: 'n' }, String(r.left.n)), h('td', { class: 't l' }, r.left.text), h('td', { class: 'mid' }), h('td', { class: 'n' }, String(r.right.n)), h('td', { class: 't r' }, r.right.text));
    if (r.type === 'mod') return h('tr', { class: 'mod' }, h('td', { class: 'n' }, String(r.left.n)), h('td', { class: 't l' }, words(r.words.left, 'w-del')), h('td', { class: 'mid' }), h('td', { class: 'n' }, String(r.right.n)), h('td', { class: 't r' }, words(r.words.right, 'w-add')));
    if (r.type === 'del') return h('tr', { class: 'del' }, h('td', { class: 'n' }, String(r.left.n)), h('td', { class: 't l' }, r.left.text), h('td', { class: 'mid' }), h('td', { class: 'n' }), h('td', { class: 't r' }));
    return h('tr', { class: 'add' }, h('td', { class: 'n' }), h('td', { class: 't l' }), h('td', { class: 'mid' }), h('td', { class: 'n' }, String(r.right.n)), h('td', { class: 't r' }, r.right.text));
  })));
}
function renderUnified(rows) {
  const out = [];
  for (const r of rows) {
    if (r.type === 'eq') out.push(h('tr', { class: 'eq' }, h('td', { class: 'n' }, String(r.left.n)), h('td', { class: 'n' }, String(r.right.n)), h('td', { class: 'sign' }, ' '), h('td', { class: 't' }, r.left.text)));
    else if (r.type === 'mod') out.push(h('tr', { class: 'del' }, h('td', { class: 'n' }, String(r.left.n)), h('td', { class: 'n' }), h('td', { class: 'sign' }, '−'), h('td', { class: 't' }, words(r.words.left, 'w-del'))), h('tr', { class: 'add' }, h('td', { class: 'n' }), h('td', { class: 'n' }, String(r.right.n)), h('td', { class: 'sign' }, '+'), h('td', { class: 't' }, words(r.words.right, 'w-add'))));
    else if (r.type === 'del') out.push(h('tr', { class: 'del' }, h('td', { class: 'n' }, String(r.left.n)), h('td', { class: 'n' }), h('td', { class: 'sign' }, '−'), h('td', { class: 't' }, r.left.text)));
    else out.push(h('tr', { class: 'add' }, h('td', { class: 'n' }), h('td', { class: 'n' }, String(r.right.n)), h('td', { class: 'sign' }, '+'), h('td', { class: 't' }, r.right.text)));
  }
  return h('table', { class: 'd', 'aria-label': 'Unified diff' }, h('tbody', {}, out));
}
/** Collapse long unchanged runs, keeping 3 lines of context around changes. */
function collapse(rows) {
  const keep = new Array(rows.length).fill(false); rows.forEach((r, i) => { if (r.type !== 'eq') for (let k = Math.max(0, i - 3); k <= Math.min(rows.length - 1, i + 3); k++) keep[k] = true; });
  const out = []; let hidden = 0; rows.forEach((r, i) => { if (keep[i]) { if (hidden) { out.push({ type: 'gap', hidden }); hidden = 0; } out.push(r); } else hidden++; }); if (hidden) out.push({ type: 'gap', hidden }); return out;
}

let result = null, errMsg = '', timer;
function compute() {
  try { result = diffTexts(st.left, st.right, { ignoreWhitespace: st.ws, ignoreCase: st.cs }); errMsg = ''; } catch (e) { result = null; errMsg = e.message; }
  drawResult();
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(compute, 120); };

function drawResult() {
  const box = $('#result'); if (!box) return;
  if (errMsg) { box.replaceChildren(h('div', { class: 'banner', role: 'alert' }, errMsg)); return; }
  if (!st.left && !st.right) { box.replaceChildren(h('p', { class: 'empty' }, 'Paste text on both sides to see the differences.')); return; }
  const s = result.stats;
  if (s.identical) { box.replaceChildren(h('p', { class: 'empty', id: 'identical' }, '✓ The texts are identical' + (st.ws || st.cs ? ' (with the selected options)' : '') + '.')); return; }
  const rows = st.onlyChanges ? collapse(result.rows) : result.rows;
  const view = st.view === 'side' ? renderSide(rows.map((r) => (r.type === 'gap' ? { type: 'eq', left: { n: '…', text: `${r.hidden} unchanged line${r.hidden === 1 ? '' : 's'}` }, right: { n: '…', text: '' } } : r))) : renderUnified(rows.filter((r) => r.type !== 'gap'));
  box.replaceChildren(h('div', { class: 'row between' }, h('div', { class: 'row', id: 'stats' }, h('span', { class: 'stat add' }, `+${s.added}`), h('span', { class: 'stat del' }, `−${s.removed}`), h('span', { class: 'muted small' }, `${s.changed} changed · ${s.unchanged} unchanged${result.coarse ? ' · very different texts: shown as a full replacement' : ''}`)),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', id: 'copy-patch', onclick: () => copy(unified(result, { leftName: 'left', rightName: 'right' }), 'Unified diff copied') }, 'Copy patch'))), h('div', { class: 'diff', id: 'diff' }, view));
}

async function loadSaved() { try { st.saved = await api('/comparisons'); } catch { st.saved = []; } drawSaved(); }
function drawSaved() {
  const box = $('#saved'); if (!box) return;
  box.replaceChildren(h('h2', {}, `Saved comparisons (${st.saved.length})`), st.saved.length ? h('ul', { class: 'list' }, st.saved.map((c) => h('li', { class: 'item', 'data-saved': c.title }, h('div', {}, h('strong', {}, c.title), h('span', { class: 'small muted' }, `  +${c.added} −${c.removed}`)),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', 'aria-label': 'Load ' + c.title, onclick: async () => { try { const f = await api('/comparisons/' + c.id); st.left = f.left; st.right = f.right; st.ws = f.ignoreWhitespace; st.cs = f.ignoreCase; draw(); compute(); toast('Loaded ' + f.title); } catch (x) { toast(x.message, 'error'); } } }, 'Load'),
      h('button', { class: 'btn sm danger', 'aria-label': 'Delete ' + c.title, onclick: async () => { try { await api('/comparisons/' + c.id, { method: 'DELETE' }); await loadSaved(); toast('Deleted'); } catch (x) { toast(x.message, 'error'); } } }, 'Delete'))))) : h('p', { class: 'muted small' }, 'Nothing saved yet.'));
}
const lineLabel = (t) => { const n = t ? t.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length : 0; return `${n.toLocaleString()} line${n === 1 ? '' : 's'}`; };
function draw() {
  const ta = (id, label, key) => h('label', { class: 'f' }, label, h('textarea', { id, spellcheck: 'false', wrap: 'off', 'aria-label': label, oninput: (e) => { st[key] = e.target.value; $('#' + id + '-count').textContent = lineLabel(st[key]); schedule(); } }, st[key]), h('span', { class: 'small muted', id: id + '-count' }, lineLabel(st[key])));
  const toggle = (id, label, key) => h('button', { class: 'btn sm', id, 'aria-pressed': String(st[key] === true), onclick: () => { st[key] = !st[key]; draw(); compute(); } }, label);
  main.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'inputs' }, ta('left', 'Original', 'left'), ta('right', 'Changed', 'right')),
    h('div', { class: 'row', style: null }, toggle('opt-ws', 'Ignore whitespace', 'ws'), toggle('opt-case', 'Ignore case', 'cs'), h('button', { class: 'btn sm', id: 'swap', onclick: () => { [st.left, st.right] = [st.right, st.left]; draw(); compute(); } }, '⇄ Swap'), h('button', { class: 'btn sm', id: 'clear', onclick: () => { st.left = st.right = ''; draw(); compute(); } }, 'Clear'),
      h('span', { class: 'row', role: 'group', 'aria-label': 'View' }, h('button', { class: 'btn sm', id: 'view-side', 'aria-pressed': String(st.view === 'side'), onclick: () => { st.view = 'side'; draw(); compute(); } }, 'Side by side'), h('button', { class: 'btn sm', id: 'view-unified', 'aria-pressed': String(st.view === 'unified'), onclick: () => { st.view = 'unified'; draw(); compute(); } }, 'Unified')), toggle('opt-changes', 'Only changes', 'onlyChanges'))),
    h('div', { class: 'card', id: 'result', 'aria-live': 'polite' }),
    h('div', { class: 'card' }, h('form', { class: 'row', novalidate: true, onsubmit: async (e) => { e.preventDefault(); const title = new FormData(e.target).get('title'); try { await api('/comparisons', { method: 'POST', body: { title, left: st.left, right: st.right, ignoreWhitespace: st.ws, ignoreCase: st.cs } }); toast('Comparison saved'); e.target.reset(); $('#save-err').textContent = ''; await loadSaved(); } catch (x) { $('#save-err').textContent = x.details ? Object.values(x.details).join(' · ') : x.message; } } },
      h('input', { type: 'text', name: 'title', id: 'save-title', 'aria-label': 'Title for this comparison', placeholder: 'Title for this comparison', maxlength: 100 }), h('button', { class: 'btn', id: 'save' }, 'Save'), h('span', { class: 'err', id: 'save-err', role: 'alert' })), h('div', { id: 'saved', class: 'savedbox' })));
  drawSaved();
}
draw(); compute(); loadSaved();
