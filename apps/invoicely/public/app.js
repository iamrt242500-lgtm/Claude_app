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
const money = (c, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(c / 100);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const cents = (v) => { const s = String(v ?? '').trim().replace(/,/g, ''); return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : null; };
const statusBadge = (i) => h('span', { class: 'badge ' + (i.overdue ? 'overdue' : i.status) }, i.overdue ? 'overdue' : i.status);
const field = (label, ctl, err) => h('label', {}, label, ctl, err && h('span', { class: 'err', role: 'alert' }, err));

function invoiceTable(rows) {
  return h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Number', 'Client', 'Due', 'Status', 'Total'].map((c, i) => h('th', { scope: 'col', class: i === 4 ? 'num' : '' }, c)))),
    h('tbody', {}, rows.map((i) => h('tr', {}, h('td', {}, h('a', { href: '#/invoices/' + i.id }, i.number)), h('td', {}, i.clientName), h('td', {}, i.dueDate), h('td', {}, statusBadge(i)), h('td', { class: 'num' }, money(i.total, i.currency)))))));
}

async function viewHome() {
  const [s, list] = await Promise.all([api('/summary'), api('/invoices')]);
  const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));
  const months = s.revenueByMonth, max = Math.max(1, ...months.map((m) => m.total));
  main.replaceChildren(h('h1', {}, 'Dashboard'),
    list.length === 0 ? h('div', { class: 'card empty' }, h('h2', {}, 'No invoices yet'), h('p', {}, 'Add a client, then create your first invoice.'), h('a', { class: 'btn primary', href: '#/clients' }, 'Add a client')) : h('div', {},
      h('div', { class: 'grid' }, ...(s.currencies.length ? s.currencies.flatMap((c) => [stat(money(c.outstanding, c.currency), `Outstanding (${c.currency})`), stat(money(c.overdue, c.currency), `Overdue (${c.currency})`), stat(money(c.paidThisYear, c.currency), `Paid this year (${c.currency})`)]) : []), stat(String(s.counts.draft), 'Drafts'), stat(String(s.counts.sent), 'Awaiting payment')),
      months.length ? h('div', { class: 'card' }, h('h2', {}, 'Revenue by month (paid)'), h('div', { class: 'bars', role: 'img', 'aria-label': 'Revenue by month' }, months.map((m) => h('div', { title: `${m.month}: ${money(m.total, m.currency)}` }, h('span', { class: 'bar', 'data-h': Math.round((m.total / max) * 100) }), m.month.slice(2))))) : null,
      h('div', { class: 'card' }, h('h2', {}, 'Recent invoices'), invoiceTable(list.slice(0, 5)))));
  document.querySelectorAll('.bar').forEach((b) => { b.style.height = b.dataset.h + '%'; });
}

async function viewInvoices() {
  let filter = 'all'; const list = await api('/invoices'); const out = h('div');
  const draw = () => {
    const rows = list.filter((i) => filter === 'all' || (filter === 'overdue' ? i.overdue : i.status === filter));
    out.replaceChildren(h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter' }, ['all', 'draft', 'sent', 'overdue', 'paid'].map((f) => h('button', { class: 'btn sm', 'aria-pressed': String(filter === f), onclick: () => { filter = f; draw(); } }, f[0].toUpperCase() + f.slice(1)))),
      rows.length ? h('div', { class: 'card' }, invoiceTable(rows)) : h('div', { class: 'card empty' }, list.length ? 'No invoices match this filter.' : 'No invoices yet.'));
  };
  main.replaceChildren(h('div', { class: 'row between' }, h('h1', {}, 'Invoices'), h('a', { class: 'btn primary', href: '#/invoices/new' }, 'New invoice')), out); draw();
}

async function viewEditor(id) {
  const [clients, existing] = await Promise.all([api('/clients'), id ? api('/invoices/' + id) : null]);
  if (!clients.length) { main.replaceChildren(h('div', { class: 'card empty' }, h('h2', {}, 'Add a client first'), h('a', { class: 'btn primary', href: '#/clients' }, 'Go to clients'))); return; }
  if (existing && existing.status !== 'draft') { main.replaceChildren(h('div', { class: 'banner', role: 'alert' }, 'Only draft invoices can be edited.', ' ', h('a', { href: '#/invoices/' + id }, 'Back'))); return; }
  const v = existing || { clientId: clients[0].id, issueDate: today(), dueDate: addDays(today(), 30), currency: 'USD', taxPercent: 0, notes: '', items: [{ description: '', qty: 1, unitCents: 0 }] };
  let errors = {}; const rows = v.items.map((i) => ({ description: i.description, qty: String(i.qty), price: i.unitCents ? (i.unitCents / 100).toFixed(2) : '' }));
  const itemsBox = h('div'), totalsBox = h('div', { class: 'totals', 'aria-live': 'polite' });
  const form = h('form', { novalidate: true, onsubmit: submit });
  const sel = (name, opts, val) => h('select', { name }, opts.map(([k, l]) => h('option', { value: k, selected: String(k) === String(val) }, l)));
  const recalc = () => {
    const cur = form.elements.currency.value, tax = Number(form.elements.taxPercent.value) || 0;
    const sub = rows.reduce((s, r) => s + (cents(r.price) != null && Number(r.qty) > 0 ? Math.round(Number(r.qty) * cents(r.price)) : 0), 0), taxC = Math.round(sub * Math.round(tax * 100) / 10000);
    totalsBox.replaceChildren(h('span', {}, 'Subtotal'), h('span', { class: 'right' }, money(sub, cur)), h('span', {}, `Tax (${tax}%)`), h('span', { class: 'right' }, money(taxC, cur)), h('span', { class: 'grand' }, 'Total'), h('span', { class: 'grand right', id: 'live-total' }, money(sub + taxC, cur)));
  };
  const drawItems = () => {
    itemsBox.replaceChildren(...rows.map((r, i) => h('div', { class: 'line' },
      h('label', { class: 'desc' }, i === 0 ? 'Description' : h('span', { class: 'small muted' }, 'Description'), h('input', { value: r.description, 'aria-label': `Line ${i + 1} description`, class: 'f-desc', oninput: (e) => { r.description = e.target.value; } })),
      h('label', {}, h('span', { class: 'small muted' }, 'Qty'), h('input', { value: r.qty, inputmode: 'decimal', 'aria-label': `Line ${i + 1} quantity`, class: 'f-qty', oninput: (e) => { r.qty = e.target.value; recalc(); } })),
      h('label', {}, h('span', { class: 'small muted' }, 'Unit price'), h('input', { value: r.price, inputmode: 'decimal', placeholder: '0.00', 'aria-label': `Line ${i + 1} unit price`, class: 'f-price', oninput: (e) => { r.price = e.target.value; recalc(); } })),
      h('div', { class: 'right small muted' }, money(cents(r.price) != null && Number(r.qty) > 0 ? Math.round(Number(r.qty) * cents(r.price)) : 0, form.elements.currency?.value || v.currency)),
      h('button', { type: 'button', class: 'btn sm danger', 'aria-label': `Remove line ${i + 1}`, disabled: rows.length === 1, onclick: () => { rows.splice(i, 1); drawItems(); recalc(); } }, '✕'))));
  };
  const build = (vals) => {
    form.replaceChildren(
      h('div', { class: 'two' }, field('Client', sel('clientId', clients.map((c) => [c.id, c.name]), vals.clientId), errors.clientId), field('Currency', sel('currency', [['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP']], vals.currency), errors.currency)),
      h('div', { class: 'three' }, field('Issue date', h('input', { type: 'date', name: 'issueDate', value: vals.issueDate }), errors.issueDate), field('Due date', h('input', { type: 'date', name: 'dueDate', value: vals.dueDate }), errors.dueDate), field('Tax %', h('input', { name: 'taxPercent', value: vals.taxPercent, inputmode: 'decimal' }), errors.taxPercent)),
      h('h2', {}, 'Line items'), itemsBox, errors.items && h('span', { class: 'err', role: 'alert' }, errors.items),
      h('div', {}, h('button', { type: 'button', class: 'btn', id: 'add-line', onclick: () => { rows.push({ description: '', qty: '1', price: '' }); drawItems(); itemsBox.querySelector('.line:last-child input')?.focus(); } }, '+ Add line')),
      totalsBox, field('Notes (shown on invoice)', h('textarea', { name: 'notes' }, vals.notes), errors.notes),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'save-invoice' }, existing ? 'Save changes' : 'Create invoice'), h('a', { class: 'btn', href: existing ? '#/invoices/' + id : '#/invoices' }, 'Cancel')));
    drawItems(); recalc();
    form.elements.currency.addEventListener('change', () => { drawItems(); recalc(); }); form.elements.taxPercent.addEventListener('input', recalc);
  };
  async function submit(e) {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(form)); const btn = $('#save-invoice'); btn.disabled = true;
    const body = { ...fd, clientId: Number(fd.clientId), items: rows.map((r) => ({ description: r.description, qty: r.qty, unitPrice: r.price })) };
    try { const saved = await api(existing ? '/invoices/' + id : '/invoices', { method: existing ? 'PUT' : 'POST', body }); toast(existing ? 'Invoice saved' : 'Invoice created'); location.hash = '#/invoices/' + saved.id; }
    catch (x) { errors = x.details || { items: x.message }; build({ ...fd, taxPercent: fd.taxPercent, notes: fd.notes }); $('.err', form)?.scrollIntoView({ block: 'center' }); }
  }
  main.replaceChildren(h('h1', {}, existing ? `Edit ${existing.number}` : 'New invoice'), h('div', { class: 'card' }, form));
  build(v);
}

async function viewInvoice(id) {
  const i = await api('/invoices/' + id);
  const act = async (status, msg) => { try { await api(`/invoices/${id}/status`, { method: 'POST', body: { status } }); toast(msg); route(); } catch (x) { toast(x.message, 'error'); } };
  const dlg = h('dialog', { 'aria-labelledby': 'dt' }, h('h2', { id: 'dt' }, `Delete ${i.number}?`), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-del', onclick: async () => { try { await api('/invoices/' + id, { method: 'DELETE' }); toast('Invoice deleted'); location.hash = '#/invoices'; } catch (x) { dlg.close(); toast(x.message, 'error'); } } }, 'Delete'), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
  const buttons = [
    i.status === 'draft' && h('a', { class: 'btn', href: `#/invoices/${id}/edit` }, 'Edit'), i.status === 'draft' && h('button', { class: 'btn primary', id: 'mark-sent', onclick: () => act('sent', 'Marked as sent') }, 'Mark as sent'),
    i.status === 'sent' && h('button', { class: 'btn primary', id: 'mark-paid', onclick: () => act('paid', 'Marked as paid') }, 'Mark as paid'), i.status === 'sent' && h('button', { class: 'btn', onclick: () => act('draft', 'Moved back to draft') }, 'Back to draft'),
    i.status === 'paid' && h('button', { class: 'btn', onclick: () => act('sent', 'Payment undone') }, 'Undo payment'),
    h('button', { class: 'btn', id: 'print', onclick: () => print() }, 'Print / PDF'), i.status === 'draft' && h('button', { class: 'btn danger', id: 'del', onclick: () => dlg.showModal() }, 'Delete')];
  main.replaceChildren(h('div', { class: 'row between no-print' }, h('a', { href: '#/invoices', class: 'small muted' }, '← All invoices'), h('div', { class: 'row' }, buttons)), h('p'),
    h('article', { class: 'paper', 'aria-label': 'Invoice ' + i.number },
      h('div', { class: 'row between' }, h('div', {}, h('h1', {}, 'INVOICE'), h('div', { class: 'muted' }, i.number)), h('div', { class: 'right' }, statusBadge(i), h('div', { class: 'small muted' }, `Issued ${i.issueDate}`), h('div', { class: 'small muted' }, `Due ${i.dueDate}`), i.paidAt && h('div', { class: 'small muted' }, `Paid ${i.paidAt}`))),
      h('p'), h('div', {}, h('div', { class: 'small muted' }, 'Bill to'), h('strong', {}, i.client.name), i.client.email && h('div', {}, i.client.email), i.client.address && h('div', { style: null, class: 'pre' }, i.client.address)),
      h('p'), h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Description'), h('th', { scope: 'col', class: 'num' }, 'Qty'), h('th', { scope: 'col', class: 'num' }, 'Unit price'), h('th', { scope: 'col', class: 'num' }, 'Amount'))),
        h('tbody', {}, i.items.map((it) => h('tr', {}, h('td', {}, it.description), h('td', { class: 'num' }, String(it.qty)), h('td', { class: 'num' }, money(it.unitCents, i.currency)), h('td', { class: 'num' }, money(it.lineCents, i.currency))))))),
      h('p'), h('div', { class: 'totals' }, h('span', {}, 'Subtotal'), h('span', { class: 'right' }, money(i.subtotal, i.currency)), h('span', {}, `Tax (${i.taxPercent}%)`), h('span', { class: 'right' }, money(i.tax, i.currency)), h('span', { class: 'grand' }, 'Total'), h('span', { class: 'grand right', id: 'inv-total' }, money(i.total, i.currency))),
      i.notes && h('p', { class: 'pre muted' }, i.notes)), dlg);
}

async function viewClients() {
  const clients = await api('/clients'); let editing = null, errors = {};
  const dlg = h('dialog', { 'aria-labelledby': 'dt' }, h('h2', { id: 'dt' }, 'Delete this client?'), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-del' }, 'Delete'), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
  const draw = () => {
    const c = editing || { name: '', email: '', address: '' };
    const form = h('form', { novalidate: true, onsubmit: async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { await api(editing ? '/clients/' + editing.id : '/clients', { method: editing ? 'PUT' : 'POST', body: fd }); toast(editing ? 'Client saved' : 'Client added'); route(); } catch (x) { errors = x.details || { name: x.message }; editing = editing ? { ...editing, ...fd } : null; draw(); if (!editing) { $('[name=name]').value = fd.name; $('[name=email]').value = fd.email; $('[name=address]').value = fd.address; } } } },
      h('div', { class: 'two' }, field('Name', h('input', { name: 'name', value: c.name, maxlength: 100 }), errors.name), field('Email', h('input', { name: 'email', value: c.email, type: 'email' }), errors.email)),
      field('Address', h('textarea', { name: 'address' }, c.address), errors.address),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'save-client' }, editing ? 'Save client' : 'Add client'), editing && h('button', { type: 'button', class: 'btn', onclick: () => { editing = null; errors = {}; draw(); } }, 'Cancel')));
    main.replaceChildren(h('h1', {}, 'Clients'), h('div', { class: 'card' }, h('h2', {}, editing ? 'Edit client' : 'Add client'), form),
      clients.length ? h('div', { class: 'card' }, h('ul', { style: null, class: 'list' }, clients.map((cl) => h('li', { class: 'row between item' }, h('div', {}, h('strong', {}, cl.name), h('div', { class: 'small muted' }, [cl.email, `${cl.invoices} invoice${cl.invoices === 1 ? '' : 's'}`].filter(Boolean).join(' · '))),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', 'aria-label': 'Edit ' + cl.name, onclick: () => { editing = cl; errors = {}; draw(); scrollTo(0, 0); } }, 'Edit'),
          h('button', { class: 'btn sm danger', 'aria-label': 'Delete ' + cl.name, onclick: () => { $('#confirm-del', dlg).onclick = async () => { try { await api('/clients/' + cl.id, { method: 'DELETE' }); dlg.close(); toast('Client deleted'); route(); } catch (x) { dlg.close(); toast(x.message, 'error'); } }; dlg.showModal(); } }, 'Delete')))))) : h('div', { class: 'card empty' }, 'No clients yet.'), dlg);
  };
  draw();
}

async function route() {
  const hash = location.hash.slice(1) || '/'; let m;
  document.querySelectorAll('nav a').forEach((a) => { const k = a.dataset.nav, on = (k === 'home' && hash === '/') || (k === 'invoices' && hash.startsWith('/invoices')) || (k === 'clients' && hash === '/clients'); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  main.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewHome(); else if (hash === '/invoices') await viewInvoices(); else if (hash === '/invoices/new') await viewEditor(null);
    else if ((m = hash.match(/^\/invoices\/(\d+)\/edit$/))) await viewEditor(m[1]); else if ((m = hash.match(/^\/invoices\/(\d+)$/))) await viewInvoice(m[1]); else if (hash === '/clients') await viewClients();
    else main.replaceChildren(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) main.replaceChildren(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/invoices' }, 'Back to invoices')));
    else main.replaceChildren(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
