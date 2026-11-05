const $ = (s, r = document) => r.querySelector(s);
const main = $('#main'), NS = 'http://www.w3.org/2000/svg';
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
const money = (c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
const localMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const localDay = () => { const d = new Date(); return `${localMonth()}-${String(d.getDate()).padStart(2, '0')}`; };
const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number), t = y * 12 + mo - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const monthLabel = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const field = (label, ctl, err) => h('label', { class: 'f' }, label, ctl, err && h('span', { class: 'err', role: 'alert' }, err));
const confirmDialog = (title, msg, onOk) => { const d = h('dialog', { 'aria-labelledby': 'cdt' }, h('h2', { id: 'cdt' }, title), msg && h('p', { class: 'muted' }, msg), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-ok', onclick: async () => { d.close(); await onOk(); } }, 'Delete'), h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'))); d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); };
let month = localMonth();
const monthNav = (onChange) => h('div', { class: 'month' }, h('button', { class: 'btn sm', 'aria-label': 'Previous month', id: 'prev-month', onclick: () => { month = addMonths(month, -1); onChange(); } }, '‹'), h('strong', { id: 'month-label' }, monthLabel(month)), h('button', { class: 'btn sm', 'aria-label': 'Next month', id: 'next-month', onclick: () => { month = addMonths(month, 1); onChange(); } }, '›'));

function svgEl(tag, attrs, text) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; }
function trendChart(trend) {
  const W = 420, H = 110, gw = W / trend.length, max = Math.max(1, ...trend.flatMap((t) => [t.income, t.expense])), svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H + 16}`, role: 'img', 'aria-label': 'Income and expenses for the last 6 months' });
  trend.forEach((t, i) => { for (const [k, cls, off] of [['income', 'inc', 0], ['expense', 'exp', 1]]) { const ht = (t[k] / max) * H, r = svgEl('rect', { class: cls, x: i * gw + 6 + off * ((gw - 12) / 2), y: H - ht, width: (gw - 12) / 2 - 1, height: ht, rx: 2 }); r.append(svgEl('title', {}, `${t.month} ${k}: ${money(t[k])}`)); svg.append(r); } svg.append(svgEl('text', { x: i * gw + gw / 2, y: H + 12, 'text-anchor': 'middle' }, t.month.slice(5))); });
  return svg;
}
function dailyChart(daily) {
  const W = 420, H = 80, bw = W / daily.length, max = Math.max(1, ...daily.map((d) => d.expense)), svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H + 14}`, role: 'img', 'aria-label': 'Spending per day this month' });
  daily.forEach((d, i) => { const ht = (d.expense / max) * H, r = svgEl('rect', { class: 'day', x: i * bw + 1, y: H - ht, width: bw - 2, height: ht, rx: 1.5 }); r.append(svgEl('title', {}, `${d.day}: ${money(d.expense)}`)); svg.append(r); });
  svg.append(svgEl('text', { x: 0, y: H + 11 }, '1'), svgEl('text', { x: W, y: H + 11, 'text-anchor': 'end' }, String(daily.length))); return svg;
}

async function viewOverview() {
  const s = await api('/summary?month=' + month), stat = (v, l, cls = '') => h('div', { class: 'stat' }, h('b', { class: cls }, v), h('span', {}, l));
  const empty = s.count === 0 && s.categories.every((c) => !c.budget);
  render(h('div', { class: 'row between' }, h('h1', {}, 'Overview'), monthNav(route)),
    h('div', { class: 'grid' }, stat(money(s.income), 'Income', 'pos'), stat(money(s.expense), 'Spent', 'neg'), stat(money(s.net), 'Net', s.net < 0 ? 'neg' : 'pos'), s.totalBudget ? stat(money(s.totalBudget - s.budgetedSpent), `Left of ${money(s.totalBudget)} budget`, s.budgetedSpent > s.totalBudget ? 'neg' : '') : null),
    empty ? h('div', { class: 'card empty' }, h('h2', {}, 'Nothing here yet'), h('p', {}, 'Set category budgets, add transactions or import a bank CSV.'), h('div', { class: 'row', style: null }, h('a', { class: 'btn primary', href: '#/transactions?new=1' }, 'Add a transaction'), h('a', { class: 'btn', href: '#/import' }, 'Import CSV')))
      : [h('div', { class: 'card' }, h('h2', {}, 'Spending by category'), s.categories.length ? h('ul', { style: null, class: 'list', id: 'cat-list' }, s.categories.map((c) => h('li', { class: 'cat-row', 'data-cat': c.name, style: null }, h('div', { class: 'row between' }, h('span', {}, h('strong', {}, c.name), c.status !== 'none' ? h('span', { class: 'badge ' + c.status }, c.status === 'over' ? 'over budget' : c.status === 'warn' ? 'nearly there' : 'on track') : null), h('span', { class: 'num' }, c.budget ? `${money(c.spent)} of ${money(c.budget)}` : money(c.spent))),
          c.budget ? h('progress', { class: c.status, max: c.budget, value: Math.min(c.spent, c.budget), 'aria-label': `${c.name}: ${c.pct}% of budget used` }) : null, c.budget ? h('div', { class: 'small ' + (c.remaining < 0 ? 'neg' : 'muted') }, c.remaining < 0 ? `${money(-c.remaining)} over` : `${money(c.remaining)} left`) : null))) : h('p', { class: 'empty' }, 'No spending this month.')),
        h('div', { class: 'two', style: null }, h('div', { class: 'card' }, h('h2', {}, 'Daily spending'), dailyChart(s.daily)), h('div', { class: 'card' }, h('h2', {}, 'Last 6 months'), trendChart(s.trend), h('p', { class: 'small muted' }, h('span', { class: 'pos' }, '■'), ' income  ', h('span', { class: 'neg' }, '■'), ' expenses')))]);
}

async function viewTransactions(qs) {
  const [cats, txs] = await Promise.all([api('/categories'), api('/transactions?month=' + month)]);
  let editing = null, filter = { q: '', type: 'all' }, form = null;
  const out = h('div');
  const list = () => {
    const rows = txs.filter((t) => (filter.type === 'all' || t.type === filter.type) && (!filter.q || (t.note + ' ' + (t.categoryName || '')).toLowerCase().includes(filter.q.toLowerCase())));
    out.replaceChildren(rows.length ? h('div', { class: 'card tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Description', 'Category', 'Amount', ''].map((c, i) => h('th', { scope: 'col', class: i === 3 ? 'right' : '' }, c)))),
      h('tbody', {}, rows.map((t) => h('tr', { 'data-tx': t.id }, h('td', {}, t.day), h('td', {}, t.note || h('span', { class: 'muted' }, '—')), h('td', {}, t.categoryName || h('span', { class: 'muted' }, 'Uncategorized')), h('td', { class: 'right num ' + (t.type === 'income' ? 'pos' : '') }, (t.type === 'expense' ? '−' : '+') + money(t.amount)),
        h('td', { class: 'right num' }, h('button', { class: 'btn sm', 'aria-label': `Edit ${t.note || t.day}`, onclick: () => { editing = t; drawForm(); scrollTo(0, 0); } }, 'Edit'), ' ', h('button', { class: 'btn sm danger', 'aria-label': `Delete ${t.note || t.day}`, onclick: () => confirmDialog('Delete this transaction?', `${t.day} · ${money(t.amount)}`, async () => { try { await api('/transactions/' + t.id, { method: 'DELETE' }); toast('Transaction deleted'); route(); } catch (x) { toast(x.message, 'error'); } }) }, '✕')))))))
      : h('div', { class: 'card empty' }, txs.length ? 'No transactions match.' : 'No transactions this month.'));
  };
  function drawForm() {
    const e = editing, v = e ?? { type: 'expense', amount: '', day: month === localMonth() ? localDay() : month + '-01', note: '', categoryId: '' }; let type = v.type;
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Type' }, ['expense', 'income'].map((k) => h('button', { type: 'button', 'data-type': k, 'aria-pressed': String(type === k), onclick: () => { type = k; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === k))); } }, k[0].toUpperCase() + k.slice(1))));
    const f = h('form', { novalidate: true, id: 'tx-form', onsubmit: async (ev) => { ev.preventDefault(); const fd = Object.fromEntries(new FormData(f)); $('#save-tx').disabled = true;
      try { await api(e ? '/transactions/' + e.id : '/transactions', { method: e ? 'PUT' : 'POST', body: { ...fd, type, categoryId: fd.categoryId || null } }); toast(e ? 'Transaction saved' : 'Transaction added'); if (fd.day.slice(0, 7) !== month) month = fd.day.slice(0, 7); editing = null; location.hash.includes('new=1') ? (location.hash = '#/transactions') : route(); }
      catch (x) { const d = x.details || { amount: x.message }; for (const k of ['type', 'amount', 'day', 'note', 'categoryId']) { const el = $('#e-' + k); if (el) el.textContent = d[k] || ''; } $('#save-tx').disabled = false; } } },
      h('div', { class: 'row' }, seg), h('div', { class: 'cols' }, field('Amount', h('input', { type: 'text', name: 'amount', id: 'amount', inputmode: 'decimal', value: e ? (e.amount / 100).toFixed(2) : '', placeholder: '0.00' })), field('Date', h('input', { type: 'date', name: 'day', id: 'day', value: v.day })), field('Category', h('select', { name: 'categoryId', id: 'categoryId' }, h('option', { value: '' }, 'Uncategorized'), cats.map((c) => h('option', { value: c.id, selected: c.id === v.categoryId }, c.name))))),
      ...['amount', 'day', 'categoryId', 'type'].map((k) => h('span', { class: 'err', id: 'e-' + k, role: 'alert' })), field('Description', h('input', { type: 'text', name: 'note', id: 'note', maxlength: 200, value: v.note })), h('span', { class: 'err', id: 'e-note', role: 'alert' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'save-tx' }, e ? 'Save changes' : 'Add transaction'), e && h('button', { type: 'button', class: 'btn', onclick: () => { editing = null; drawForm(); } }, 'Cancel')));
    form.replaceChildren(h('h2', {}, e ? 'Edit transaction' : 'Add a transaction'), f);
  }
  form = h('div', { class: 'card' });
  render(h('div', { class: 'row between' }, h('h1', {}, 'Transactions'), h('div', { class: 'row' }, monthNav(route), h('a', { class: 'btn sm', href: '/api/export', download: '', id: 'export' }, 'Export CSV'))), form,
    h('div', { class: 'row' }, h('input', { type: 'search', id: 'search', 'aria-label': 'Search transactions', placeholder: 'Search…', style: null, oninput: (e) => { filter.q = e.target.value; list(); } }), h('select', { id: 'type-filter', 'aria-label': 'Type filter', onchange: (e) => { filter.type = e.target.value; list(); } }, ['all', 'expense', 'income'].map((k) => h('option', { value: k }, k === 'all' ? 'All types' : k[0].toUpperCase() + k.slice(1))))), h('p'), out);
  drawForm(); list(); if (qs?.get('new')) $('#amount').focus();
}

async function viewCategories() {
  const [cats, s] = await Promise.all([api('/categories'), api('/summary?month=' + month)]); let errs = {};
  const spent = Object.fromEntries(s.categories.filter((c) => c.id).map((c) => [c.id, c.spent]));
  const addForm = h('form', { novalidate: true, onsubmit: async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { await api('/categories', { method: 'POST', body: fd }); toast('Category added'); route(); } catch (x) { errs = x.details || { name: x.message }; $('#e-name').textContent = errs.name || ''; $('#e-budget').textContent = errs.budget || ''; } } },
    h('div', { class: 'cols' }, field('Name', h('input', { type: 'text', name: 'name', id: 'cat-name', maxlength: 40, placeholder: 'e.g. Groceries' })), field('Monthly budget (optional)', h('input', { type: 'text', name: 'budget', id: 'cat-budget', inputmode: 'decimal', placeholder: '0.00' }))), h('span', { class: 'err', id: 'e-name', role: 'alert' }), h('span', { class: 'err', id: 'e-budget', role: 'alert' }), h('div', {}, h('button', { class: 'btn primary', id: 'add-cat' }, 'Add category')));
  render(h('div', { class: 'row between' }, h('h1', {}, 'Budgets'), monthNav(route)), h('div', { class: 'card' }, h('h2', {}, 'New category'), addForm),
    cats.length ? h('div', { class: 'card' }, h('ul', { class: 'list' }, cats.map((c) => { const row = h('li', { class: 'row between', 'data-cat': c.name, style: null });
      const show = () => row.replaceChildren(h('div', {}, h('strong', {}, c.name), h('div', { class: 'small muted' }, c.budget ? `Budget ${money(c.budget)} / month · spent ${money(spent[c.id] || 0)} in ${monthLabel(month)}` : `No budget · spent ${money(spent[c.id] || 0)} in ${monthLabel(month)}`)), h('div', { class: 'row' }, h('button', { class: 'btn sm', 'aria-label': 'Edit ' + c.name, onclick: edit }, 'Edit'), h('button', { class: 'btn sm danger', 'aria-label': 'Delete ' + c.name, onclick: () => confirmDialog(`Delete "${c.name}"?`, 'Its transactions are kept and become uncategorized.', async () => { try { await api('/categories/' + c.id, { method: 'DELETE' }); toast('Category deleted'); route(); } catch (x) { toast(x.message, 'error'); } }) }, 'Delete')));
      const edit = () => row.replaceChildren(h('form', { class: 'row', novalidate: true, onsubmit: async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { await api('/categories/' + c.id, { method: 'PUT', body: fd }); toast('Category saved'); route(); } catch (x) { toast(x.details ? Object.values(x.details)[0] : x.message, 'error'); } } },
        h('input', { type: 'text', name: 'name', value: c.name, 'aria-label': 'Name', maxlength: 40 }), h('input', { type: 'text', name: 'budget', value: c.budget ? (c.budget / 100).toFixed(2) : '', 'aria-label': 'Monthly budget', placeholder: 'No budget', inputmode: 'decimal' }), h('button', { class: 'btn sm primary' }, 'Save'), h('button', { type: 'button', class: 'btn sm', onclick: show }, 'Cancel')));
      show(); return row; }))) : h('div', { class: 'card empty' }, 'No categories yet.'));
}

async function viewImport() {
  let result = null, csvText = '', order = 'ymd';
  const out = h('div'), ta = h('textarea', { id: 'csv', 'aria-label': 'CSV text', placeholder: 'Date,Description,Amount\n2026-03-01,Coffee,-4.50' });
  const drawResult = () => {
    if (!result) return out.replaceChildren();
    const r = result, canGo = r.toImport > 0;
    out.replaceChildren(h('div', { class: 'card', id: 'preview' }, h('h2', {}, 'Preview'), h('p', {}, h('strong', { id: 'summary-line' }, `${r.toImport} to import`), ` · ${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'} skipped · ${r.errorCount} invalid line${r.errorCount === 1 ? '' : 's'}`),
      r.preview.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Description', 'Category', 'Amount'].map((c) => h('th', { scope: 'col' }, c)))), h('tbody', {}, r.preview.map((x) => h('tr', {}, h('td', {}, x.day), h('td', {}, x.note), h('td', {}, x.category || '—'), h('td', { class: 'num ' + (x.type === 'income' ? 'pos' : '') }, (x.type === 'expense' ? '−' : '+') + money(x.amount))))))) : null,
      r.errorCount ? h('div', { class: 'banner', role: 'alert', id: 'import-errors' }, h('strong', {}, `${r.errorCount} line(s) have problems`), h('ul', {}, r.errors.slice(0, 8).map((e) => h('li', {}, `Line ${e.line}: ${e.message}`)))) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'do-import', disabled: !canGo, onclick: () => commit(false) }, `Import ${r.toImport} transaction${r.toImport === 1 ? '' : 's'}`), r.errorCount && canGo ? h('span', { class: 'small muted' }, 'Invalid lines are skipped.') : null)));
  };
  const call = async (dryRun) => api('/import', { method: 'POST', body: { csv: csvText, dateOrder: order, dryRun, skipInvalid: true } });
  async function analyze() { csvText = ta.value; $('#csv-err').textContent = ''; try { result = await call(true); drawResult(); } catch (x) { result = null; drawResult(); $('#csv-err').textContent = x.details?.csv || x.message; } }
  async function commit() { const b = $('#do-import'); b.disabled = true; try { const r = await call(false); toast(`Imported ${r.imported} transactions`); location.hash = '#/transactions'; route(); } catch (x) { toast(x.message, 'error'); b.disabled = false; } }
  render(h('h1', {}, 'Import bank CSV'), h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Needs a header row with a date column and an amount column (or Debit / Credit columns). Negative amounts are expenses. Exact duplicates of existing transactions are skipped.'),
    h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); analyze(); } }, ta, h('span', { class: 'err', id: 'csv-err', role: 'alert' }),
      h('div', { class: 'row' }, h('input', { type: 'file', id: 'file', accept: '.csv,.txt,text/csv', 'aria-label': 'CSV file', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 2e6) { $('#csv-err').textContent = 'File too large (max 2 MB)'; return; } ta.value = await f.text(); analyze(); } }),
        h('label', { class: 'row' }, 'Date format', h('select', { id: 'date-order', onchange: (e) => { order = e.target.value; if (ta.value.trim()) analyze(); } }, [['ymd', 'YYYY-MM-DD'], ['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY']].map(([k, l]) => h('option', { value: k }, l)))), h('button', { class: 'btn primary', id: 'analyze' }, 'Preview'))), out));
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const [hash, qs] = (location.hash.slice(1) || '/').split('?'), params = new URLSearchParams(qs || '');
  document.querySelectorAll('nav a').forEach((a) => { const on = a.dataset.nav === ({ '/': 'home', '/transactions': 'transactions', '/categories': 'categories', '/import': 'import' }[hash]); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewOverview(); else if (hash === '/transactions') await viewTransactions(params); else if (hash === '/categories') await viewCategories(); else if (hash === '/import') await viewImport();
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) { render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry'))); }
}
addEventListener('hashchange', route); route();
