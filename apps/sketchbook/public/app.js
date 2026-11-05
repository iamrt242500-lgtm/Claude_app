import { simplify, W, H, BG } from './draw.js';
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
const render = (...kids) => main.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
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
const confirmDialog = (title, onOk, label = 'Delete') => { const d = h('dialog', { 'aria-labelledby': 'cdt' }, h('h2', { id: 'cdt' }, title), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-ok', onclick: async () => { d.close(); await onOk(); } }, label), h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'))); d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); };

/* ---------- gallery ---------- */
async function viewGallery() {
  const list = await api('/drawings');
  render(h('h1', {}, 'Your drawings'), list.length ? h('ul', { class: 'gallery' }, list.map((d) => h('li', { 'data-title': d.title }, h('a', { href: '#/d/' + d.id, 'aria-label': 'Open ' + d.title }, h('img', { src: `/api/drawings/${d.id}/svg?v=${encodeURIComponent(d.updatedAt)}`, alt: `Preview of ${d.title}`, loading: 'lazy' })),
    h('div', { class: 'meta' }, h('a', { class: 'open', href: '#/d/' + d.id }, d.title), h('div', { class: 'small muted' }, `${d.strokeCount} stroke${d.strokeCount === 1 ? '' : 's'}`),
      h('div', { class: 'row' }, h('a', { class: 'btn sm', href: `/api/drawings/${d.id}/svg?download=1` }, 'SVG'), h('button', { class: 'btn sm danger', 'aria-label': 'Delete ' + d.title, onclick: () => confirmDialog(`Delete "${d.title}"?`, async () => { try { await api('/drawings/' + d.id, { method: 'DELETE' }); toast('Drawing deleted'); route(); } catch (x) { toast(x.message, 'error'); } }) }, 'Delete')))))) : h('div', { class: 'card empty' }, h('h2', {}, 'No drawings yet'), h('a', { class: 'btn primary', href: '#/new' }, 'Start drawing')));
}

/* ---------- editor ---------- */
const PALETTE = ['#111111', '#e11d48', '#f97316', '#eab308', '#16a34a', '#0ea5e9', '#7c3aed', '#92400e'];
let cleanupEditor = null;
async function viewEditor(id) {
  const doc = id ? await api('/drawings/' + id) : { id: null, title: 'Untitled drawing', strokes: [] };
  const st = { id: doc.id, title: doc.title, strokes: doc.strokes.map((s) => ({ ...s })), undoStack: [], redoStack: [], tool: 'pen', color: PALETTE[0], size: 6, drawing: null, dirty: false, saving: false };
  const canvas = h('canvas', { id: 'canvas', 'aria-label': 'Drawing canvas', role: 'img', tabindex: '0' }), dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr; const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const statusEl = h('span', { class: 'status', id: 'status', role: 'status' }, id ? 'Saved' : 'Not saved yet');
  const setStatus = (t) => { statusEl.textContent = t; };

  const paintStroke = (s) => {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; const c = s.tool === 'eraser' ? BG : s.color; ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = s.size;
    if (s.points.length === 1) { ctx.beginPath(); ctx.arc(s.points[0][0], s.points[0][1], s.size / 2, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(...s.points[0]); for (let i = 1; i < s.points.length - 1; i++) ctx.quadraticCurveTo(s.points[i][0], s.points[i][1], (s.points[i][0] + s.points[i + 1][0]) / 2, (s.points[i][1] + s.points[i + 1][1]) / 2); ctx.lineTo(...s.points.at(-1)); ctx.stroke(); }
    ctx.restore();
  };
  const redraw = () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = BG; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); for (const s of st.strokes) paintStroke(s); if (st.drawing) paintStroke(st.drawing); };
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * W * 10) / 10, Math.round(((e.clientY - r.top) / r.height) * H * 10) / 10]; };

  const touch = () => { st.dirty = true; setStatus('Unsaved changes…'); clearTimeout(touch.t); touch.t = setTimeout(save, 1500); sync(); };
  async function save(manual) {
    if (st.saving) { clearTimeout(touch.t); touch.t = setTimeout(save, 500); return; }
    clearTimeout(touch.t); if (!st.dirty && !manual && st.id) return; st.saving = true; setStatus('Saving…');
    const body = { title: st.title, strokes: st.strokes.map((s) => ({ ...s, points: simplify(s.points, 0.6) })) };
    try { const d = await api(st.id ? '/drawings/' + st.id : '/drawings', { method: st.id ? 'PUT' : 'POST', body }); const first = !st.id; st.id = d.id; st.dirty = false; setStatus('Saved'); if (first && location.hash === '#/new') history.replaceState(null, '', '#/d/' + d.id); /* only while still on this screen: a save finishing after navigation must not rewrite the new URL */ if (manual) toast('Drawing saved'); }
    catch (x) { setStatus('Not saved'); toast(x.details ? Object.values(x.details)[0] : x.message, 'error'); st.dirty = true; }
    finally { st.saving = false; sync(); }
  }
  // History is a stack of ACTIONS ({t:'add', stroke} | {t:'clear', prev}), so clearing the canvas is one undoable step.
  st.undoStack = st.strokes.map((stroke) => ({ t: 'add', stroke }));
  const apply = (a) => { if (a.t === 'add') st.strokes.push(a.stroke); else { a.prev = st.strokes.slice(); st.strokes = []; } };
  const revert = (a) => { if (a.t === 'add') st.strokes.pop(); else st.strokes = a.prev.slice(); };
  const perform = (a) => { apply(a); st.undoStack.push(a); st.redoStack = []; redraw(); touch(); };
  const undo = () => { const a = st.undoStack.pop(); if (!a) return; revert(a); st.redoStack.push(a); redraw(); touch(); };
  const redo = () => { const a = st.redoStack.pop(); if (!a) return; apply(a); st.undoStack.push(a); redraw(); touch(); };

  canvas.addEventListener('pointerdown', (e) => { if (e.button !== 0 && e.pointerType === 'mouse') return; canvas.setPointerCapture(e.pointerId); st.drawing = { tool: st.tool, color: st.color, size: st.size, points: [pt(e)] }; redraw(); });
  canvas.addEventListener('pointermove', (e) => { if (!st.drawing) return; const p = pt(e), l = st.drawing.points.at(-1); if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 0.8) return; st.drawing.points.push(p); if (st.drawing.points.length > 4900) finish(); else redraw(); });
  const finish = () => { if (!st.drawing) return; const stroke = st.drawing; st.drawing = null; perform({ t: 'add', stroke }); };
  canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish);
  const key = (e) => { if (e.target.closest?.('input,textarea,select')) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); } };
  document.addEventListener('keydown', key);
  const beforeUnload = (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload);
  cleanupEditor = async () => { document.removeEventListener('keydown', key); window.removeEventListener('beforeunload', beforeUnload); clearTimeout(touch.t); while (st.saving) await new Promise((r) => setTimeout(r, 50)); if (st.dirty) await save(); };   // finish saving before leaving, so the gallery is never stale

  const toolBtn = (tool, label) => h('button', { class: 'btn', 'data-tool': tool, 'aria-pressed': String(st.tool === tool), onclick: () => { st.tool = tool; sync(); } }, label);
  const undoBtn = h('button', { class: 'btn', id: 'undo', onclick: undo }, '↶ Undo'), redoBtn = h('button', { class: 'btn', id: 'redo', onclick: redo }, '↷ Redo');
  function sync() { undoBtn.disabled = !st.undoStack.length; redoBtn.disabled = !st.redoStack.length; document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === st.tool))); document.querySelectorAll('.sw').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === st.color && st.tool === 'pen'))); $('#count') && ($('#count').textContent = `${st.strokes.length} stroke${st.strokes.length === 1 ? '' : 's'}`); }
  const exportPng = () => canvas.toBlob((b) => { const a = h('a', { href: URL.createObjectURL(b), download: (st.title.replace(/[^\w-]+/g, '_') || 'drawing') + '.png' }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }, 'image/png');

  render(h('div', { class: 'row between' }, h('input', { type: 'text', id: 'title', value: st.title, maxlength: 80, 'aria-label': 'Drawing title', onchange: (e) => { st.title = e.target.value.trim() || 'Untitled drawing'; e.target.value = st.title; touch(); } }), h('div', { class: 'row' }, statusEl, h('button', { class: 'btn primary', id: 'save', onclick: () => save(true) }, 'Save'))),
    h('div', { class: 'tools', role: 'toolbar', 'aria-label': 'Drawing tools' }, toolBtn('pen', '✏️ Pen'), toolBtn('eraser', '🧽 Eraser'),
      h('div', { class: 'swatches', role: 'group', 'aria-label': 'Colours' }, PALETTE.map((c) => { const b = h('button', { class: 'sw', 'data-color': c, 'aria-label': 'Colour ' + c, 'aria-pressed': String(c === st.color), onclick: () => { st.color = c; st.tool = 'pen'; $('#color').value = c; sync(); } }); b.style.backgroundColor = c; return b; })   /* CSSOM is allowed by the CSP; inline style attributes are not */), h('input', { type: 'color', id: 'color', value: st.color, 'aria-label': 'Custom colour', oninput: (e) => { st.color = e.target.value; st.tool = 'pen'; sync(); } }),
      h('label', { class: 'row small' }, 'Size', h('input', { type: 'range', id: 'size', min: 1, max: 40, value: st.size, oninput: (e) => { st.size = Number(e.target.value); } })), undoBtn, redoBtn,
      h('button', { class: 'btn', id: 'clear', onclick: () => st.strokes.length && confirmDialog('Clear the whole drawing? You can undo this.', () => perform({ t: 'clear' }), 'Clear') }, 'Clear')),
    h('div', { class: 'canvaswrap' }, canvas), h('div', { class: 'row small muted' }, h('span', { id: 'count' }), ' · Ctrl/⌘+Z undo · Ctrl/⌘+Shift+Z redo'),
    h('div', { class: 'row' }, h('button', { class: 'btn', id: 'export-png', onclick: exportPng }, 'Export PNG'), h('a', { class: 'btn', id: 'export-svg', href: '#', onclick: async (e) => { e.preventDefault(); if (!st.id || st.dirty) await save(true); if (st.id) location.href = `/api/drawings/${st.id}/svg?download=1`; } }, 'Export SVG'), h('a', { class: 'btn', href: '#/' }, 'Gallery')));
  redraw(); sync();
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const leaving = cleanupEditor; cleanupEditor = null; await leaving?.();
  const hash = location.hash.slice(1) || '/'; let m;
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewGallery(); else if (hash === '/new') await viewEditor(null); else if ((m = hash.match(/^\/d\/(\d+)$/))) await viewEditor(m[1]);
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) render(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to gallery')));
    else render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
