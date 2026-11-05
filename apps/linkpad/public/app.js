import { parseMarkdown } from './md.js';
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

/* ---- Markdown AST -> DOM (never innerHTML) ---- */
function inline(nodes, ctx) {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'code': return h('code', {}, n.v);
      case 'bold': return h('strong', {}, inline(n.c, ctx));
      case 'em': return h('em', {}, inline(n.c, ctx));
      case 'link': return h('a', { href: n.href, ...(n.href.startsWith('#') ? {} : { target: '_blank', rel: 'noopener noreferrer' }) }, inline(n.c, ctx));
      case 'wiki': { const hit = ctx.links?.get(n.title.toLowerCase()); return hit ? h('a', { class: 'wiki', href: '#/n/' + hit.id }, n.label) : h('a', { class: 'wiki ghost', href: '#/new?title=' + encodeURIComponent(n.title), title: `"${n.title}" doesn't exist yet — click to create it` }, n.label); }
      default: return '';
    }
  });
}
function blocks(list, ctx) {
  return list.map((b) => {
    switch (b.t) {
      case 'heading': return h('h' + Math.min(6, b.level + 0), {}, inline(b.c, ctx));
      case 'p': return h('p', {}, inline(b.c, ctx));
      case 'hr': return h('hr');
      case 'quote': return h('blockquote', {}, blocks(b.c, ctx));
      case 'codeblock': return h('pre', {}, h('code', b.lang ? { 'data-lang': b.lang } : {}, b.v));
      case 'list': return h(b.ordered ? 'ol' : 'ul', {}, b.items.map((it) => h('li', it.task ? { class: 'task' } : {}, it.task ? h('input', { type: 'checkbox', disabled: true, checked: it.checked, 'aria-label': it.checked ? 'done' : 'not done' }) : null, it.task ? ' ' : null, inline(it.c, ctx))));
      default: return '';
    }
  });
}
const mdView = (text, links) => h('div', { class: 'md' }, blocks(parseMarkdown(text), { links: new Map((links || []).filter((l) => l.id).map((l) => [l.target, l])) }));

/* ---- sidebar ---- */
let query = '', currentId = null;
async function refreshList() {
  const ul = $('#note-list'), status = $('#list-status');
  try {
    const rows = await api('/notes' + (query ? '?q=' + encodeURIComponent(query) : ''));
    ul.replaceChildren(...rows.map((n) => h('li', {}, h('a', { href: '#/n/' + n.id, ...(n.id === currentId ? { 'aria-current': 'page' } : {}) }, n.title, n.excerpt ? h('span', { class: 'ex' }, n.excerpt) : null))));
    status.textContent = rows.length ? `${rows.length} note${rows.length === 1 ? '' : 's'}${query ? ' found' : ''}` : (query ? 'No notes match.' : 'No notes yet.');
  } catch (e) { status.textContent = e.message; }
}
let st; $('#search').addEventListener('input', (e) => { clearTimeout(st); st = setTimeout(() => { query = e.target.value.trim(); refreshList(); }, 200); });

/* ---- views ---- */
async function viewNote(id) {
  const n = await api('/notes/' + id); currentId = n.id;
  const dlg = h('dialog', { 'aria-labelledby': 'dt' }, h('h2', { id: 'dt' }, `Delete "${n.title}"?`), h('p', { class: 'muted' }, 'Links to it from other notes will become unresolved.'), h('div', { class: 'row' },
    h('button', { class: 'btn danger', id: 'confirm-del', onclick: async () => { try { await api('/notes/' + id, { method: 'DELETE' }); toast('Note deleted'); location.hash = '#/'; } catch (x) { dlg.close(); toast(x.message, 'error'); } } }, 'Delete'), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
  render(h('div', { class: 'row between' }, h('h1', {}, n.title), h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/n/${id}/edit`, id: 'edit' }, 'Edit'), h('button', { class: 'btn danger', id: 'del', onclick: () => dlg.showModal() }, 'Delete'))),
    mdView(n.body, n.links), n.body.trim() ? null : h('p', { class: 'muted' }, 'This note is empty. Click Edit to write something.'),
    h('section', { class: 'card', 'aria-labelledby': 'bl' }, h('h2', { id: 'bl' }, `Linked from (${n.backlinks.length})`), n.backlinks.length ? h('ul', { class: 'list', id: 'backlinks' }, n.backlinks.map((b) => h('li', {}, h('a', { href: '#/n/' + b.id }, b.title)))) : h('p', { class: 'muted small' }, 'No other note links here yet. Use [[' + n.title + ']] in another note.')),
    h('p', { class: 'small muted' }, `Updated ${n.updatedAt} UTC`), dlg);
  refreshList();
}

async function viewEditor(id, prefillTitle) {
  const n = id ? await api('/notes/' + id) : { title: prefillTitle || '', body: '', links: [] }; currentId = id ? n.id : null;
  let errs = {};
  const body = h('textarea', { name: 'body', id: 'body', spellcheck: 'true', 'aria-label': 'Note body (Markdown)' }, n.body), preview = h('div', { class: 'preview', 'aria-label': 'Preview' });
  let known = new Map((n.links || []).filter((l) => l.id).map((l) => [l.target, l])), pt;
  const drawPreview = () => { preview.replaceChildren(h('div', { class: 'md' }, blocks(parseMarkdown(body.value), { links: known }))); };
  body.addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(async () => { // resolve unknown links lazily so the preview shows real vs ghost links
    const titles = [...body.value.matchAll(/\[\[([^\[\]|\n]{1,100})(?:\|[^\[\]\n]*)?\]\]/g)].map((m) => m[1].trim()).filter((t) => !known.has(t.toLowerCase())).slice(0, 10);
    for (const t of titles) { try { const r = await api('/resolve?title=' + encodeURIComponent(t)); if (r) known.set(t.toLowerCase(), { id: r.id }); } catch { /* ignore preview errors */ } }
    drawPreview(); }, 250); drawPreview(); });
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); const btn = $('#save'); btn.disabled = true;
    try { const saved = await api(id ? '/notes/' + id : '/notes', { method: id ? 'PUT' : 'POST', body: { title: $('#title').value, body: body.value } }); toast('Note saved'); location.hash = '#/n/' + saved.id; }
    catch (x) { errs = x.details || { title: x.message }; $('#terr').textContent = errs.title || ''; $('#berr').textContent = errs.body || ''; btn.disabled = false; if (errs.title) $('#title').focus(); } } },
    h('label', { class: 'f' }, 'Title', h('input', { type: 'text', name: 'title', id: 'title', value: n.title, maxlength: 100 }), h('span', { class: 'err', id: 'terr', role: 'alert' })),
    h('div', { class: 'editor' }, h('label', { class: 'f' }, 'Body (Markdown, [[wikilinks]])', body, h('span', { class: 'err', id: 'berr', role: 'alert' })), h('div', {}, h('div', { class: 'small muted' }, 'Preview'), preview)),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'save' }, 'Save note'), h('a', { class: 'btn', href: id ? '#/n/' + id : '#/' }, 'Cancel')));
  render(h('h1', {}, id ? 'Edit note' : 'New note'), h('div', { class: 'card' }, form)); drawPreview(); refreshList();
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const full = location.hash.slice(1) || '/', [hash, qs] = full.split('?'); let m; currentId = null;
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') { render(h('div', { class: 'empty' }, h('h2', {}, 'Welcome to Linkpad'), h('p', {}, 'Write notes in Markdown and connect them with [[wikilinks]]. Every note shows what links back to it.'), h('a', { class: 'btn primary', href: '#/new' }, 'Create a note'))); refreshList(); }
    else if (hash === '/new') await viewEditor(null, new URLSearchParams(qs || '').get('title'));
    else if ((m = hash.match(/^\/n\/(\d+)\/edit$/))) await viewEditor(m[1]); else if ((m = hash.match(/^\/n\/(\d+)$/))) await viewNote(m[1]);
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) render(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back home')));
    else render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
