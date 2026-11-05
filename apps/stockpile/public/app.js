import { parseMoney, formatMoney } from '/inventory.js';
const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3500); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(method, path, body) {
  const r = await fetch('/api' + path + (path.includes('?') ? '&' : '?') + 'today=' + localToday(), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; throw e; } return j;
}
const errText = (e) => (e.details ? Object.values(e.details).join(' · ') : e.message), $ = formatMoney, th = (...x) => h('tr', null, x.map((t) => h('th', null, t)));

async function itemsView(sp) {
  const items = await api('GET', '/items'), onlyLow = sp.get('low') === '1', shown = onlyLow ? items.filter((i) => i.low && !i.archived) : items;
  const sku = h('input', { id: 'sku', placeholder: 'SKU', size: 10 }), name = h('input', { id: 'name', placeholder: 'Name' }), unit = h('input', { id: 'unit', value: 'pcs', size: 5, 'aria-label': 'Unit' }), rp = h('input', { id: 'rp', type: 'number', min: 0, value: 0, 'aria-label': 'Reorder point' }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
  const create = async (ev) => { ev.preventDefault(); err.textContent = ''; try { await api('POST', '/items', { sku: sku.value, name: name.value, unit: unit.value, reorderPoint: Number(rp.value) }); await route(); } catch (e) { err.textContent = errText(e); } };
  const lowCount = items.filter((i) => i.low && !i.archived).length, total = items.filter((i) => !i.archived).reduce((s, i) => s + i.value, 0);
  render(h('h1', null, 'Items'), h('p', { class: 'meta', id: 'summary' }, `${items.filter((i) => !i.archived).length} items · stock value ${$(total)} · `, h('a', { href: onlyLow ? '#/' : '#/?low=1', id: 'low-toggle' }, onlyLow ? 'show all' : `${lowCount} low`)),
    h('form', { class: 'card row', onsubmit: create }, h('div', null, h('label', { for: 'sku' }, 'SKU'), sku), h('div', null, h('label', { for: 'name' }, 'Name'), name), h('div', null, h('label', { for: 'unit' }, 'Unit'), unit), h('div', null, h('label', { for: 'rp' }, 'Reorder at'), rp), h('button', { class: 'primary' }, 'Add item'), err),
    shown.length ? h('div', { class: 'scroll' }, h('table', { class: 't', id: 'items' }, h('thead', null, th('Item', 'On hand', 'Value', 'Cover', '')), h('tbody', null, shown.map((i) => h('tr', { 'data-sku': i.sku, class: i.archived ? 'arch' : '' }, h('td', null, h('a', { href: `#/item/${i.id}` }, `${i.sku} · ${i.name}`)), h('td', { class: i.low ? 'low' : '' }, `${i.onHand} ${i.unit}`), h('td', null, $(i.value)), h('td', null, i.daysOfCover === null ? '—' : `${i.daysOfCover} d`), h('td', null, i.low && !i.archived ? h('span', { class: 'chip overdue' }, 'Reorder') : i.archived ? 'archived' : '')))))) : h('p', { class: 'empty' }, onlyLow ? 'Nothing is low on stock.' : 'No items yet.'));
}
async function itemView(id) {
  const load = async () => draw(await api('GET', `/items/${id}`));
  function draw(it) {
    const type = h('select', { id: 'mtype', 'aria-label': 'Movement type' }, ['receive', 'issue', 'adjust'].map((t) => h('option', { value: t }, t[0].toUpperCase() + t.slice(1)))), qty = h('input', { id: 'mqty', type: 'number', step: 1, 'aria-label': 'Quantity', size: 6 }), cost = h('input', { id: 'mcost', placeholder: 'unit cost', 'aria-label': 'Unit cost', size: 8 }), day = h('input', { id: 'mday', type: 'date', value: localToday(), max: localToday(), 'aria-label': 'Date' }), note = h('input', { id: 'mnote', placeholder: 'note (optional)', maxlength: 120, 'aria-label': 'Note' }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
    const sync = () => { cost.disabled = type.value === 'issue' || (type.value === 'adjust' && Number(qty.value) < 0); if (cost.disabled) cost.value = ''; qty.min = type.value === 'adjust' ? '' : 1; }; type.addEventListener('change', sync); qty.addEventListener('input', sync); sync();
    const post = async (ev) => { ev.preventDefault(); err.textContent = ''; try { await api('POST', `/items/${id}/movements`, { type: type.value, qty: Number(qty.value), unitCost: cost.value, day: day.value, note: note.value }); toast('Recorded'); await load(); } catch (e) { err.textContent = errText(e); } };
    render(h('h1', null, `${it.sku} · ${it.name}`), h('p', { class: 'meta', id: 'stat' }, h('span', { id: 'onhand', class: it.low ? 'low' : '' }, `${it.onHand} ${it.unit} on hand`), ` · value ${$(it.value)} · usage ${it.usagePerDay}/day · cover ${it.daysOfCover === null ? '—' : it.daysOfCover + ' days'} · reorder at ${it.reorderPoint}`),
      it.archived ? h('p', { class: 'meta' }, 'Archived — no new movements.') : h('form', { class: 'card row', onsubmit: post }, h('div', null, type), h('div', null, qty), h('div', null, cost), h('div', null, day), h('div', null, note), h('button', { class: 'primary', id: 'record' }, 'Record'), err),
      h('h2', null, 'Cost layers (oldest first)'), it.lots.length ? h('table', { class: 't', id: 'lots' }, h('thead', null, th('Received', 'Qty left', 'Unit cost', 'Value')), h('tbody', null, it.lots.map((l) => h('tr', null, h('td', null, l.day), h('td', null, l.qty), h('td', null, $(l.cost)), h('td', null, $(l.qty * l.cost)))))) : h('p', { class: 'empty' }, 'No stock.'),
      h('h2', null, 'History'), h('div', { class: 'scroll' }, h('table', { class: 't', id: 'history' }, h('thead', null, th('Date', 'Type', 'Qty', 'Cost', 'Balance', 'Note', '')), h('tbody', null, it.movements.map((m) => h('tr', { 'data-mid': m.id }, h('td', null, m.day), h('td', null, m.type), h('td', null, m.type === 'issue' ? -m.qty : m.qty > 0 ? `+${m.qty}` : m.qty), h('td', null, $(m.cost)), h('td', null, m.balance), h('td', { class: 'l' }, m.note), h('td', null, h('button', { class: 'danger', 'aria-label': `Delete movement ${m.id}`, onclick: async () => { if (!confirm('Delete this movement?')) return; try { await api('DELETE', `/movements/${m.id}`); await load(); } catch (e) { toast(errText(e)); } } }, '✕'))))))),
      h('p', null, h('a', { href: '#/' }, '← Items'), ' ', h('button', { id: 'archive', onclick: async () => { await api('PATCH', `/items/${id}`, { archived: !it.archived }); await load(); } }, it.archived ? 'Restore' : 'Archive')));
  }
  await load();
}
async function reportsView(sp) {
  const asOf = sp.get('asOf') || localToday(), to = sp.get('to') || localToday(), from = sp.get('from') || to.slice(0, 8) + '01', [val, cogs, low] = await Promise.all([api('GET', `/reports/valuation?asOf=${asOf}`), api('GET', `/reports/cogs?from=${from}&to=${to}`), api('GET', '/reports/low-stock')]);
  const a = h('input', { id: 'asof', type: 'date', value: asOf }), f = h('input', { id: 'from', type: 'date', value: from }), t = h('input', { id: 'to', type: 'date', value: to }); const go = () => { location.hash = `#/reports?asOf=${a.value}&from=${f.value}&to=${t.value}`; }; for (const el of [a, f, t]) el.addEventListener('change', go);
  render(h('h1', null, 'Reports'), h('h2', null, 'Inventory valuation'), h('div', { class: 'row' }, h('label', { for: 'asof' }, 'As of'), a), h('div', { class: 'scroll' }, h('table', { class: 't', id: 'valuation' }, h('thead', null, th('Item', 'On hand', 'Avg cost', 'Value')), h('tbody', null, val.rows.map((r) => h('tr', { 'data-sku': r.sku }, h('td', null, `${r.sku} · ${r.name}`), h('td', null, r.onHand), h('td', null, r.avgCost === null ? '—' : $(r.avgCost)), h('td', null, $(r.value)))), h('tr', { class: 'tot' }, h('td', null, 'Total'), h('td', null), h('td', null), h('td', { id: 'val-total' }, $(val.total)))))),
    h('h2', null, 'Cost of goods sold & shrinkage'), h('div', { class: 'row' }, h('label', { for: 'from' }, 'From'), f, h('label', { for: 'to' }, 'To'), t), h('table', { class: 't', id: 'cogs' }, h('thead', null, th('Item', 'COGS (issues)', 'Shrinkage (write-offs)')), h('tbody', null, cogs.rows.map((r) => h('tr', { 'data-sku': r.sku }, h('td', null, `${r.sku} · ${r.name}`), h('td', null, $(r.cogs)), h('td', null, $(r.shrinkage)))), h('tr', { class: 'tot' }, h('td', null, 'Total'), h('td', { id: 'cogs-total' }, $(cogs.cogs)), h('td', { id: 'shrink-total' }, $(cogs.shrinkage))))),
    h('h2', null, 'Reorder list'), low.length ? h('ul', { id: 'reorder' }, low.map((i) => h('li', { 'data-sku': i.sku }, h('a', { href: `#/item/${i.id}` }, `${i.sku} · ${i.name}`), ` — ${i.onHand} left (reorder at ${i.reorderPoint})${i.daysOfCover === null ? '' : `, about ${i.daysOfCover} days of cover`}`))) : h('p', { class: 'empty' }, 'Nothing needs reordering.'));
}
let routing = Promise.resolve();
async function doRoute() {
  const [path, qs] = location.hash.slice(1).split('?'), parts = path.split('/').filter(Boolean), sp = new URLSearchParams(qs || ''); document.getElementById('nav-items').removeAttribute('aria-current'); document.getElementById('nav-reports').removeAttribute('aria-current');
  try {
    if (!parts.length) { document.getElementById('nav-items').setAttribute('aria-current', 'page'); await itemsView(sp); } else if (parts[0] === 'item' && parts[1]) await itemView(Number(parts[1])); else if (parts[0] === 'reports') { document.getElementById('nav-reports').setAttribute('aria-current', 'page'); await reportsView(sp); }
    else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back'));
  } catch (e) { render(h('h1', null, e.status === 404 ? 'Not found' : 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
