const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v; else if (k === 'value') el.value = v;
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
let cleanup = null;
const field = (label, ctl, name, errs) => h('label', {}, label, ctl, errs?.[name] && h('span', { class: 'err', role: 'alert' }, errs[name]));

async function viewDecks() {
  const decks = await api('/decks');
  let err = '';
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    try { const d = await api('/decks', { method: 'POST', body: { name: new FormData(e.target).get('name') } }); toast('Deck created'); location.hash = '#/deck/' + d.id; }
    catch (x) { $('#derr').textContent = x.details?.name || x.message; }
  } }, h('div', { class: 'row' }, h('input', { name: 'name', 'aria-label': 'New deck name', placeholder: 'New deck name', maxlength: 80, id: 'deck-name' }), h('button', { class: 'btn primary', id: 'add-deck' }, 'Create deck')), h('span', { class: 'err', id: 'derr', role: 'alert' }));
  main.replaceChildren(h('h1', {}, 'Your decks'), h('div', { class: 'card' }, form),
    decks.length ? h('div', { class: 'card' }, h('ul', { class: 'list' }, decks.map((d) => h('li', { class: 'item' },
      h('div', {}, h('a', { href: '#/deck/' + d.id, class: 'deck-link' }, h('strong', {}, d.name)), h('div', { class: 'small muted' }, `${d.cards} card${d.cards === 1 ? '' : 's'}`)),
      h('div', { class: 'row' }, h('span', { class: 'badge' + (d.due ? '' : ' zero') }, `${d.due} due`), (d.due ? h('a', { class: 'btn primary', href: '#/study/' + d.id }, 'Study') : h('button', { class: 'btn', disabled: true, title: 'No cards due' }, 'Study')))))))
      : h('div', { class: 'card empty' }, 'No decks yet. Create one above to get started.'));
}

async function viewDeck(id) {
  const deck = await api('/decks/' + id);
  let errs = {}, bulk = false;
  const dlg = h('dialog', { 'aria-labelledby': 'dt' }, h('h2', { id: 'dt' }, 'Delete this deck and all its cards?'),
    h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-del', onclick: async () => { try { await api('/decks/' + id, { method: 'DELETE' }); toast('Deck deleted'); location.hash = '#/'; } catch (x) { dlg.close(); toast(x.message, 'error'); } } }, 'Delete'), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
  const draw = () => {
    const add = bulk
      ? h('form', { onsubmit: submit(true) }, field('One card per line: front :: back', h('textarea', { name: 'bulk', rows: 6, placeholder: 'capital of France :: Paris' }), 'bulk', errs), h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'import' }, 'Import'), h('button', { type: 'button', class: 'btn', onclick: () => { bulk = false; errs = {}; draw(); } }, 'Single card')))
      : h('form', { onsubmit: submit(false) }, field('Front', h('textarea', { name: 'front', rows: 2 }), 'front', errs), field('Back', h('textarea', { name: 'back', rows: 2 }), 'back', errs), h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'add-card' }, 'Add card'), h('button', { type: 'button', class: 'btn', id: 'to-bulk', onclick: () => { bulk = true; errs = {}; draw(); } }, 'Bulk import')));
    const due = deck.cards.filter((c) => c.due <= new Date().toISOString().slice(0, 10)).length;
    main.replaceChildren(
      h('div', { class: 'row between' }, h('h1', {}, deck.name), h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/study/' + id }, `Study (${due} due)`), h('button', { class: 'btn danger', id: 'del-deck', onclick: () => dlg.showModal() }, 'Delete deck'))),
      h('div', { class: 'card' }, h('h2', {}, 'Add cards'), add),
      h('div', { class: 'card' }, h('h2', {}, `Cards (${deck.cards.length})`), deck.cards.length ? h('ul', { class: 'list' }, deck.cards.map(cardRow)) : h('p', { class: 'empty' }, 'No cards yet.')), dlg);
  };
  const submit = (isBulk) => async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api(`/decks/${id}/cards`, { method: 'POST', body: fd });
      toast(isBulk ? `Imported ${r.imported} cards` : 'Card added'); errs = {};
      Object.assign(deck, await api('/decks/' + id)); draw(); $('textarea', main)?.focus();
    } catch (x) { errs = x.details || { [isBulk ? 'bulk' : 'front']: x.message }; draw(); }
  };
  const cardRow = (c) => {
    const li = h('li', { class: 'item' });
    const show = () => li.replaceChildren(h('div', {}, h('strong', {}, c.front), h('div', { class: 'muted' }, c.back), h('div', { class: 'small muted' }, c.reps ? `Next: ${c.due} · interval ${c.interval}d` : 'New')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: edit }, 'Edit'), h('button', { class: 'btn danger', onclick: async () => { try { await api('/cards/' + c.id, { method: 'DELETE' }); deck.cards = deck.cards.filter((x) => x.id !== c.id); toast('Card deleted'); draw(); } catch (x) { toast(x.message, 'error'); } } }, 'Delete')));
    const edit = () => li.replaceChildren(h('form', { onsubmit: async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { Object.assign(c, await api('/cards/' + c.id, { method: 'PUT', body: fd })); toast('Card saved'); show(); } catch (x) { toast(x.details ? Object.values(x.details)[0] : x.message, 'error'); } } },
      h('textarea', { name: 'front', 'aria-label': 'Front' }, c.front), h('textarea', { name: 'back', 'aria-label': 'Back' }, c.back), h('div', { class: 'row' }, h('button', { class: 'btn primary' }, 'Save'), h('button', { type: 'button', class: 'btn', onclick: show }, 'Cancel'))));
    show(); return li;
  };
  draw();
}

async function viewStudy(id) {
  const [deck, queue] = await Promise.all([api('/decks/' + id), api(`/decks/${id}/study`)]);
  let i = 0, flipped = false, busy = false; const total = queue.length;
  const draw = () => {
    if (i >= total) {
      main.replaceChildren(h('div', { class: 'card empty' }, h('h2', {}, total ? 'Session complete 🎉' : 'Nothing due'), h('p', {}, total ? `You reviewed ${total} card${total === 1 ? '' : 's'}.` : 'Come back when cards are due.'), h('a', { class: 'btn primary', href: '#/deck/' + id }, 'Back to deck')));
      return;
    }
    const c = queue[i];
    main.replaceChildren(h('div', { class: 'row between' }, h('h1', {}, deck.name), h('span', { class: 'muted', id: 'pos' }, `${i + 1} / ${total}`)),
      h('progress', { max: total, value: i, 'aria-label': 'Session progress' }),
      h('div', { class: 'card study', id: 'flash', role: 'button', tabindex: '0', 'aria-label': flipped ? 'Answer' : 'Question, press space to reveal', onclick: flip }, flipped ? c.back : c.front),
      flipped ? h('div', { class: 'grades' }, [['Again', 1], ['Hard', 2], ['Good', 3], ['Easy', 4]].map(([l, g]) => h('button', { class: 'btn', 'data-grade': g, onclick: () => grade(g) }, `${g} · ${l}`)))
        : h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'show', onclick: flip }, 'Show answer (space)')));
    ($('[data-grade="3"]') || $('#show'))?.focus();
  };
  const flip = () => { if (!flipped && i < total) { flipped = true; draw(); } };
  async function grade(g) {
    if (busy || !flipped) return; busy = true;
    try { await api(`/cards/${queue[i].id}/grade`, { method: 'POST', body: { grade: g } }); i++; flipped = false; draw(); }
    catch (x) { toast(x.message, 'error'); } finally { busy = false; }
  }
  const key = (e) => {
    if (e.target.closest?.('input,textarea')) return;
    if (e.key === ' ' && e.target.id !== 'show') { e.preventDefault(); flip(); }
    if (['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key));
  };
  document.addEventListener('keydown', key); cleanup = () => document.removeEventListener('keydown', key);
  draw();
}

async function viewStats() {
  const s = await api('/stats');
  const max = Math.max(1, ...s.days.map((d) => d.n)), W = 600, H = 140, bw = W / 14;
  const NS = 'http://www.w3.org/2000/svg';
  const chart = document.createElementNS(NS, 'svg'); chart.setAttribute('viewBox', `0 0 ${W} ${H + 18}`); chart.setAttribute('class', 'chart'); chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', 'Reviews per day, last 14 active days');
  s.days.forEach((d, k) => {
    const r = document.createElementNS(NS, 'rect'), ht = (d.n / max) * H;
    Object.entries({ x: k * bw + 4, y: H - ht, width: bw - 8, height: ht, rx: 3 }).forEach(([a, v]) => r.setAttribute(a, v));
    const t = document.createElementNS(NS, 'title'); t.textContent = `${d.day}: ${d.n} reviews`; r.append(t);
    const l = document.createElementNS(NS, 'text'); l.setAttribute('x', k * bw + bw / 2); l.setAttribute('y', H + 13); l.setAttribute('text-anchor', 'middle'); l.textContent = d.day.slice(5);
    chart.append(r, l);
  });
  const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, l));
  main.replaceChildren(h('h1', {}, 'Stats'), h('div', { class: 'grid' }, stat(s.cards, 'Cards'), stat(s.due, 'Due now'), stat(s.reviewedToday, 'Reviewed today'), stat(s.retention == null ? '—' : s.retention + '%', 'Retention (Hard/Good/Easy)')),
    s.days.length ? h('div', { class: 'card' }, h('h2', {}, 'Reviews per day'), chart) : h('div', { class: 'card empty' }, 'Study some cards to see your history.'));
}

async function route() {
  cleanup?.(); cleanup = null;
  const hash = location.hash.slice(1) || '/'; let m;
  document.querySelectorAll('nav a').forEach((a) => { const on = (a.dataset.nav === 'decks' && !hash.startsWith('/stats')) || (a.dataset.nav === 'stats' && hash === '/stats'); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  main.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewDecks();
    else if (hash === '/stats') await viewStats();
    else if ((m = hash.match(/^\/deck\/(\d+)$/))) await viewDeck(m[1]);
    else if ((m = hash.match(/^\/study\/(\d+)$/))) await viewStudy(m[1]);
    else main.replaceChildren(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) main.replaceChildren(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to decks')));
    else main.replaceChildren(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
