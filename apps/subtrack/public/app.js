import { formatMoney as $ } from '/subs.js';
const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(method, path, body) {
  const r = await fetch('/api' + path + (path.includes('?') ? '&' : '?') + 'today=' + localToday(), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; throw e; } return j;
}
const errText = (e) => (e.details ? Object.values(e.details).join(' · ') : e.message), fmt = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const cycle = (s) => `${s.every === 1 ? 'every' : `every ${s.every}`} ${s.unit}${s.every > 1 ? 's' : ''}`, when = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

async function overviewView(sp) {
  const days = [14, 30, 90].includes(Number(sp.get('days'))) ? Number(sp.get('days')) : 30, o = await api('GET', `/overview?days=${days}`), max = Math.max(1, ...o.byCategory.map((c) => c.monthly));
  const sel = h('select', { id: 'days', 'aria-label': 'Look ahead', onchange: () => { location.hash = `#/?days=${sel.value}`; } }, [14, 30, 90].map((d) => h('option', { value: d, selected: d === days }, `Next ${d} days`)));
  render(h('h1', null, 'Overview'), h('div', { class: 'statgrid', id: 'summary' }, [['Active', o.count], ['Per month', $(o.monthly)], ['Per year', $(o.yearly)], [`Next ${days} days`, $(o.upcomingTotal)]].map(([l, v]) => h('div', { class: 'card' }, h('b', null, v), l))),
    o.cancelledCount ? h('p', { class: 'meta', id: 'saved' }, `Cancelled ${o.cancelledCount}: saving ${$(o.savedPerMonth)} a month (${$(o.savedPerYear)} a year).`) : null,
    h('h2', null, 'By category (monthly)'), o.byCategory.length ? o.byCategory.map((c) => h('div', { class: 'cat', 'data-cat': c.category }, h('span', null, c.category), h('div', { class: 'bar' }, h('i', { 'data-w': Math.round((c.monthly / max) * 100) })), h('span', null, $(c.monthly)))) : h('p', { class: 'empty' }, 'Nothing yet.'),
    h('div', { class: 'row' }, h('h2', null, 'Upcoming payments'), sel), o.upcoming.length ? h('div', { class: 'cards', id: 'upcoming' }, o.upcoming.map((u) => h('div', { class: 'card row', 'data-up': `${u.name}:${u.date}` }, h('strong', null, u.name), h('span', null, fmt(u.date)), h('span', { class: u.daysUntil <= 3 ? 'soon' : 'meta' }, when(u.daysUntil)), h('span', null, $(u.amount))))) : h('p', { class: 'empty' }, 'No payments in this window.'));
  document.querySelectorAll('[data-w]').forEach((el) => { el.style.width = el.dataset.w + '%'; });
}
async function subsView() {
  const [list, cats] = await Promise.all([api('GET', '/subs'), api('GET', '/categories')]);
  const name = h('input', { id: 'name', maxlength: 60 }), price = h('input', { id: 'price', inputmode: 'decimal', size: 7, placeholder: '9.99' }), every = h('input', { id: 'every', type: 'number', min: 1, max: 52, value: 1, size: 3 }), unit = h('select', { id: 'unit' }, ['month', 'year', 'week'].map((u) => h('option', { value: u }, u))), start = h('input', { id: 'start', type: 'date', value: localToday() }), cat = h('select', { id: 'category' }, cats.map((c) => h('option', { value: c }, c))), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
  render(h('h1', null, 'Subscriptions'), h('form', { class: 'card row', onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; try { await api('POST', '/subs', { name: name.value, price: price.value, unit: unit.value, every: Number(every.value), start: start.value, category: cat.value }); await route(); } catch (e) { err.textContent = errText(e); } } }, h('div', null, h('label', { for: 'name' }, 'Name'), name), h('div', null, h('label', { for: 'price' }, 'Price'), price), h('div', null, h('label', { for: 'every' }, 'Every'), every), h('div', null, h('label', { for: 'unit' }, 'Unit'), unit), h('div', null, h('label', { for: 'start' }, 'First payment'), start), h('div', null, h('label', { for: 'category' }, 'Category'), cat), h('button', { class: 'primary' }, 'Add'), err),
    list.length ? h('div', { class: 'cards', id: 'subs' }, list.map((s) => h('div', { class: 'card' + (s.active ? '' : ' off'), 'data-sub': s.name }, h('div', { class: 'row' }, h('strong', null, s.name), h('span', { class: 'chip' }, s.category), s.active ? null : h('span', { class: 'chip' }, 'cancelled')), h('div', { class: 'meta' }, `${$(s.price)} ${cycle(s)} · ${$(s.monthly)}/mo`, s.nextRenewal ? ` · renews ${fmt(s.nextRenewal)} (${when(s.daysUntil)})` : ''),
      h('p', null, s.active ? h('button', { 'data-cancel': s.name, 'aria-label': `Cancel ${s.name}`, onclick: async () => { await api('POST', `/subs/${s.id}/cancel`); await route(); } }, 'Cancel') : h('button', { 'aria-label': `Resume ${s.name}`, onclick: async () => { await api('POST', `/subs/${s.id}/resume`); await route(); } }, 'Resume'), ' ', h('button', { class: 'danger', 'aria-label': `Delete ${s.name}`, onclick: async () => { if (!confirm(`Delete ${s.name}?`)) return; await api('DELETE', `/subs/${s.id}`); await route(); } }, 'Delete'))))) : h('p', { class: 'empty' }, 'No subscriptions yet.'));
}
let routing = Promise.resolve();
async function doRoute() {
  const [path, qs] = location.hash.slice(1).split('?'), parts = path.split('/').filter(Boolean), sp = new URLSearchParams(qs || ''); document.getElementById('nav-over').removeAttribute('aria-current'); document.getElementById('nav-subs').removeAttribute('aria-current');
  try { if (!parts.length) { document.getElementById('nav-over').setAttribute('aria-current', 'page'); await overviewView(sp); } else if (parts[0] === 'subs') { document.getElementById('nav-subs').setAttribute('aria-current', 'page'); await subsView(); } else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back')); }
  catch (e) { render(h('h1', null, 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
