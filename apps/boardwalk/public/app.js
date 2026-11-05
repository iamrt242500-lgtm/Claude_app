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
// Always flattens: never pass arrays straight to replaceChildren.
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
const today = () => new Date().toISOString().slice(0, 10);
const field = (label, ctl, err) => h('label', {}, label, ctl, err && h('span', { class: 'err', role: 'alert' }, err));
const confirmDialog = (title, onOk, okLabel = 'Delete') => {
  const dlg = h('dialog', { 'aria-labelledby': 'cdt' }, h('h2', { id: 'cdt' }, title), h('div', { class: 'row' },
    h('button', { class: 'btn danger', id: 'confirm-ok', onclick: async () => { dlg.close(); await onOk(); } }, okLabel), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
};

async function viewBoards() {
  const boards = await api('/boards');
  const form = h('form', { novalidate: true, onsubmit: async (e) => { e.preventDefault(); try { const b = await api('/boards', { method: 'POST', body: { name: new FormData(e.target).get('name') } }); toast('Board created'); location.hash = '#/b/' + b.id; } catch (x) { $('#nerr').textContent = x.details?.name || x.message; } } },
    h('div', { class: 'row' }, h('input', { name: 'name', id: 'board-name', 'aria-label': 'Board name', placeholder: 'New board name', maxlength: 80 }), h('button', { class: 'btn primary', id: 'create-board' }, 'Create board')), h('span', { class: 'err', id: 'nerr', role: 'alert' }));
  main.className = 'narrow';
  render(h('h1', {}, 'Your boards'), h('div', { class: 'card' }, form),
    boards.length ? h('div', { class: 'card' }, h('ul', { class: 'list' }, boards.map((b) => h('li', { class: 'item' }, h('div', {}, h('a', { href: '#/b/' + b.id }, h('strong', {}, b.name)), h('div', { class: 'small muted' }, `${b.cards} card${b.cards === 1 ? '' : 's'}`)),
      h('button', { class: 'btn sm danger', 'aria-label': 'Delete board ' + b.name, onclick: () => confirmDialog(`Delete board "${b.name}" and all its cards?`, async () => { try { await api('/boards/' + b.id, { method: 'DELETE' }); toast('Board deleted'); route(); } catch (x) { toast(x.message, 'error'); } }) }, 'Delete')))))
      : h('div', { class: 'card empty' }, 'No boards yet. Create one above.'));
}

async function viewBoard(id) {
  let board = await api('/boards/' + id), query = '';
  main.className = '';
  const set = (b) => { board = b; draw(); };
  const dropIndex = (zone, y) => { const cards = [...zone.querySelectorAll('.kcard:not(.dragging)')]; const i = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }); return i === -1 ? cards.length : i; };
  const move = async (cardId, columnId, index) => { try { set(await api(`/cards/${cardId}/move`, { method: 'POST', body: { columnId, index } })); } catch (x) { toast(x.message, 'error'); draw(); } };

  function openCard(card, colIdx) {
    let errs = {};
    const dlg = h('dialog', { 'aria-labelledby': 'ct' });
    const build = (v) => {
      const cols = board.columns;
      dlg.replaceChildren(h('h2', { id: 'ct' }, 'Edit card'), h('form', { novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
        try { await api('/cards/' + card.id, { method: 'PUT', body: { title: fd.title, description: fd.description, due: fd.due || null, labels: fd.labels } }); if (Number(fd.columnId) !== card.columnId) await api(`/cards/${card.id}/move`, { method: 'POST', body: { columnId: Number(fd.columnId) } }); dlg.close(); toast('Card saved'); set(await api('/boards/' + id)); }
        catch (x) { errs = x.details || { title: x.message }; build(fd); } } },
        field('Title', h('input', { name: 'title', value: v.title, maxlength: 200 }), errs.title), field('Description', h('textarea', { name: 'description' }, v.description), errs.description),
        h('div', { class: 'row' }, field('Due', h('input', { type: 'date', name: 'due', value: v.due || '' }), errs.due), field('Labels (comma separated)', h('input', { name: 'labels', value: Array.isArray(v.labels) ? v.labels.join(', ') : v.labels }))),
        field('Column', h('select', { name: 'columnId' }, cols.map((c) => h('option', { value: c.id, selected: c.id === card.columnId }, c.name)))),
        h('div', { class: 'row between' }, h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'save-card' }, 'Save'), h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel')),
          h('button', { type: 'button', class: 'btn danger', id: 'delete-card', onclick: async () => { try { await api('/cards/' + card.id, { method: 'DELETE' }); dlg.close(); toast('Card deleted'); set(await api('/boards/' + id)); } catch (x) { toast(x.message, 'error'); } } }, 'Delete'))),
        h('div', { class: 'row small' }, h('span', { class: 'muted' }, 'Move:'),
          h('button', { class: 'btn sm', id: 'move-left', disabled: colIdx === 0, onclick: async () => { dlg.close(); await move(card.id, board.columns[colIdx - 1].id); } }, '← Left'),
          h('button', { class: 'btn sm', id: 'move-right', disabled: colIdx === board.columns.length - 1, onclick: async () => { dlg.close(); await move(card.id, board.columns[colIdx + 1].id); } }, 'Right →')));
    };
    build(card); dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
  }

  function column(col, idx) {
    const q = query.toLowerCase(), visible = col.cards.filter((c) => !q || [c.title, c.description, ...c.labels].join(' ').toLowerCase().includes(q));
    const zone = h('div', { class: 'cards', 'data-col': col.id, 'aria-label': `${col.name} cards` });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; zone.classList.add('over'); });
    zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('over'); });
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); const cid = Number(e.dataTransfer.getData('text/plain')); if (cid) move(cid, col.id, dropIndex(zone, e.clientY)); });
    zone.append(...visible.map((c) => {
      const late = c.due && c.due < today() && col !== board.columns.at(-1);
      const el = h('button', { class: 'kcard', draggable: 'true', 'data-card': c.id, onclick: () => openCard(c, idx) }, h('div', { class: 'title' }, c.title), c.labels.map((l) => h('span', { class: 'chip' }, l)), c.due && h('div', { class: 'due' + (late ? ' late' : '') }, (late ? 'Overdue · ' : 'Due ') + c.due));
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => el.classList.add('dragging'), 0); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      return el;
    }));
    const add = h('form', { class: 'addform', novalidate: true, onsubmit: async (e) => { e.preventDefault(); const t = new FormData(e.target).get('title'); try { await api(`/columns/${col.id}/cards`, { method: 'POST', body: { title: t } }); set(await api('/boards/' + id)); $(`[data-addcol="${col.id}"]`)?.focus(); } catch (x) { toast(x.details?.title || x.message, 'error'); } } },
      h('input', { name: 'title', 'data-addcol': col.id, 'aria-label': `Add card to ${col.name}`, placeholder: '+ Add a card', maxlength: 200 }));
    return h('section', { class: 'col', 'aria-label': col.name }, h('header', {}, h('h2', {}, col.name, h('span', { class: 'count' }, String(col.cards.length))),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', 'aria-label': 'Rename column ' + col.name, onclick: () => { const dlg = h('dialog', { 'aria-labelledby': 'rt' }, h('h2', { id: 'rt' }, 'Rename column'), h('form', { onsubmit: async (e) => { e.preventDefault(); try { set(await api('/columns/' + col.id, { method: 'PUT', body: { name: new FormData(e.target).get('name') } })); dlg.close(); } catch (x) { $('#rerr', dlg).textContent = x.details?.name || x.message; } } }, h('input', { name: 'name', value: col.name, 'aria-label': 'Column name', maxlength: 40 }), h('span', { class: 'err', id: 'rerr', role: 'alert' }), h('div', { class: 'row' }, h('button', { class: 'btn primary' }, 'Save'), h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel')))); dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal(); } }, '✎'),
        h('button', { class: 'btn sm danger', 'aria-label': 'Delete column ' + col.name, onclick: () => confirmDialog(`Delete column "${col.name}" and its ${col.cards.length} card(s)?`, async () => { try { set(await api('/columns/' + col.id, { method: 'DELETE' })); toast('Column deleted'); } catch (x) { toast(x.message, 'error'); } }) }, '✕'))), zone, add);
  }

  function draw() {
    const search = h('input', { type: 'search', id: 'filter', 'aria-label': 'Filter cards', placeholder: 'Filter cards…', value: query, oninput: (e) => { query = e.target.value; const pos = e.target.selectionStart; draw(); const f = $('#filter'); f.focus(); f.setSelectionRange(pos, pos); } });
    render(h('div', { class: 'tools' }, h('a', { href: '#/', class: 'small muted' }, '← Boards'), h('h1', {}, board.name), search,
      h('button', { class: 'btn', id: 'add-column', onclick: () => { const dlg = h('dialog', { 'aria-labelledby': 'at' }, h('h2', { id: 'at' }, 'Add column'), h('form', { onsubmit: async (e) => { e.preventDefault(); try { set(await api(`/boards/${id}/columns`, { method: 'POST', body: { name: new FormData(e.target).get('name') } })); dlg.close(); } catch (x) { $('#aerr', dlg).textContent = x.details?.name || x.message; } } }, h('input', { name: 'name', 'aria-label': 'Column name', maxlength: 40 }), h('span', { class: 'err', id: 'aerr', role: 'alert' }), h('div', { class: 'row' }, h('button', { class: 'btn primary' }, 'Add'), h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel')))); dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal(); } }, '+ Column')),
      h('div', { class: 'board' }, board.columns.map(column)));
  }
  draw();
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const hash = location.hash.slice(1) || '/'; let m; main.className = '';
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewBoards(); else if ((m = hash.match(/^\/b\/(\d+)$/))) await viewBoard(m[1]);
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    main.className = 'narrow';
    if (e.status === 404) render(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to boards')));
    else render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
