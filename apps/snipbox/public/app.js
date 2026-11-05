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
const toast = (m, t = '') => { const e = h('div', { class: 'toast ' + t }, m); $('#toasts').append(e); setTimeout(() => e.remove(), 4000); };
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
const hl = (parts, fallback) => (parts?.length ? parts.map((p) => (p.hit ? h('mark', {}, p.text) : p.text)) : fallback);
const field = (label, ctl, err) => h('label', { class: 'f' }, label, ctl, err && h('span', { class: 'err', role: 'alert' }, err));
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { const t = h('textarea', { 'aria-hidden': 'true' }, text); document.body.append(t); t.select(); try { document.execCommand('copy') ? toast('Copied to clipboard') : toast('Copy failed — select and copy manually', 'error'); } finally { t.remove(); } }
}

const filters = { q: '', tag: '', language: '', pinned: false };
async function viewList() {
  const [meta, items] = await Promise.all([api('/tags'), api('/snippets?' + new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, v === true ? '1' : v])))]);
  const toggle = (k, v) => () => { filters[k] = filters[k] === v ? '' : v; route(); };
  const filterBtn = (label, count, k, v) => h('button', { 'aria-pressed': String(filters[k] === v), onclick: toggle(k, v) }, h('span', {}, label), h('span', { class: 'small' }, String(count)));
  const side = h('aside', { class: 'side', 'aria-label': 'Filters' }, h('button', { 'aria-pressed': String(filters.pinned), id: 'pinned-filter', onclick: () => { filters.pinned = !filters.pinned; route(); } }, h('span', {}, '★ Pinned')),
    meta.languages.length ? [h('h2', {}, 'Languages'), meta.languages.map((l) => filterBtn(l.language, l.count, 'language', l.language))] : null,
    meta.tags.length ? [h('h2', {}, 'Tags'), meta.tags.map((t) => filterBtn('#' + t.tag, t.count, 'tag', t.tag))] : null);
  const search = h('input', { type: 'search', id: 'search', 'aria-label': 'Search snippets', placeholder: 'Search title, code, notes, tags…', value: filters.q });
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { filters.q = search.value; route().then(() => { const s = $('#search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); }, 250); });
  const active = filters.q || filters.tag || filters.language || filters.pinned;
  render(h('div', { class: 'layout' }, side, h('div', {}, h('div', { class: 'row', style: null }, search), h('p', { class: 'small muted', id: 'count' }, `${items.length} snippet${items.length === 1 ? '' : 's'}${active ? ' match' : ''}${filters.q ? ' (best match first)' : ''}`),
    items.length ? items.map((s) => h('article', { class: 'card hit' },
      h('div', { class: 'row between' }, h('h2', {}, h('a', { href: '#/s/' + s.id }, s.pinned ? '★ ' : '', s.title)), h('span', {}, h('span', { class: 'chip lang' }, s.language), s.tags.map((x) => h('span', { class: 'chip' }, '#' + x)))),
      h('pre', { class: 'preview' }, h('code', {}, s.highlight ? hl(s.highlight, s.code) : s.code.split('\n').slice(0, 8).join('\n'))))) :
      h('div', { class: 'card empty' }, meta.total === 0 ? [h('h2', {}, 'Your library is empty'), h('p', {}, 'Save the snippets you keep re-googling.'), h('a', { class: 'btn primary', href: '#/new' }, 'Add your first snippet')] : 'No snippets match your search.'))));
}

function viewForm(existing) {
  const v = existing || { title: '', language: 'text', code: '', notes: '', tags: [] }; let errs = {};
  const build = (vals) => {
    const form = h('form', { novalidate: true, onsubmit: async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(form)); const btn = $('#save'); btn.disabled = true;
      try { const s = await api(existing ? '/snippets/' + existing.id : '/snippets', { method: existing ? 'PUT' : 'POST', body: fd }); toast('Snippet saved'); location.hash = '#/s/' + s.id; }
      catch (x) { errs = x.details || { title: x.message }; build(fd); } } },
      field('Title', h('input', { type: 'text', name: 'title', value: vals.title, maxlength: 120 }), errs.title),
      h('div', { class: 'two' }, field('Language', h('input', { type: 'text', name: 'language', value: vals.language, list: 'langs', maxlength: 20 }), errs.language), field('Tags (comma separated)', h('input', { type: 'text', name: 'tags', value: Array.isArray(vals.tags) ? vals.tags.join(', ') : vals.tags }), errs.tags)),
      h('datalist', { id: 'langs' }, ['text', 'js', 'ts', 'python', 'go', 'rust', 'java', 'c', 'cpp', 'bash', 'sql', 'html', 'css', 'json', 'yaml'].map((l) => h('option', { value: l }))),
      field('Code', h('textarea', { name: 'code', class: 'code', spellcheck: 'false' }, vals.code), errs.code), field('Notes', h('textarea', { name: 'notes' }, vals.notes), errs.notes),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'save' }, existing ? 'Save changes' : 'Save snippet'), h('a', { class: 'btn', href: existing ? '#/s/' + existing.id : '#/' }, 'Cancel')));
    render(h('h1', {}, existing ? 'Edit snippet' : 'New snippet'), h('div', { class: 'card' }, form));
  };
  build(v);
}

async function viewSnippet(id) {
  const s = await api('/snippets/' + id);
  const dlg = h('dialog', { 'aria-labelledby': 'dt' }, h('h2', { id: 'dt' }, `Delete "${s.title}"?`), h('div', { class: 'row' },
    h('button', { class: 'btn danger', id: 'confirm-del', onclick: async () => { try { await api('/snippets/' + id, { method: 'DELETE' }); toast('Snippet deleted'); location.hash = '#/'; } catch (x) { dlg.close(); toast(x.message, 'error'); } } }, 'Delete'), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
  render(h('a', { href: '#/', class: 'small muted' }, '← Library'),
    h('div', { class: 'row between' }, h('h1', {}, s.pinned ? '★ ' : '', s.title), h('div', { class: 'row' },
      h('button', { class: 'btn', id: 'copy', onclick: () => copy(s.code) }, 'Copy code'),
      h('button', { class: 'btn', id: 'pin', 'aria-pressed': String(s.pinned), onclick: async () => { try { await api(`/snippets/${id}/pin`, { method: 'POST', body: { pinned: !s.pinned } }); route(); } catch (x) { toast(x.message, 'error'); } } }, s.pinned ? 'Unpin' : 'Pin'),
      h('a', { class: 'btn', href: `#/s/${id}/edit` }, 'Edit'), h('button', { class: 'btn danger', id: 'del', onclick: () => dlg.showModal() }, 'Delete'))),
    h('p', {}, h('span', { class: 'chip lang' }, s.language), s.tags.map((t) => h('span', { class: 'chip' }, '#' + t)), h('span', { class: 'small muted' }, ` Updated ${s.updatedAt} UTC`)),
    h('pre', {}, h('code', { id: 'code' }, s.code)), s.notes ? h('div', { class: 'card' }, h('h2', {}, 'Notes'), h('p', { class: 'pre-wrap' }, s.notes)) : null, dlg);
}

$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    if (f.size > 5e6) throw new Error('File too large (max 5 MB)');
    let data; try { data = JSON.parse(await f.text()); } catch { throw new Error('That file is not valid JSON'); }
    const r = await api('/import', { method: 'POST', body: data });
    toast(`Imported ${r.imported}${r.skipped ? `, skipped ${r.skipped} invalid` : ''}`, r.skipped && !r.imported ? 'error' : ''); route();
  } catch (x) { toast(x.details ? Object.values(x.details)[0] : x.message, 'error'); }
});

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const hash = location.hash.slice(1) || '/'; let m;
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewList(); else if (hash === '/new') viewForm(null);
    else if ((m = hash.match(/^\/s\/(\d+)\/edit$/))) viewForm(await api('/snippets/' + m[1])); else if ((m = hash.match(/^\/s\/(\d+)$/))) await viewSnippet(m[1]);
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) render(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to library')));
    else render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', () => { route(); });
route();
