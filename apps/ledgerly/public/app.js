import { parseMoney, formatMoney, validateEntry } from '/ledger.js';
const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; throw e; } return j;
}
const errText = (e) => (e.details ? Object.values(e.details).join(' · ') : e.message), $ = formatMoney, th = (...x) => h('tr', null, x.map((t, i) => h('th', { class: i === 0 ? 'l' : '' }, t)));

async function journalView() {
  const entries = await api('GET', '/entries');
  render(h('h1', null, 'Journal'), entries.length ? entries.map((e) => h('div', { class: 'card' + (e.voidedBy ? ' void' : ''), 'data-entry': e.id },
    h('div', { class: 'row' }, h('strong', null, `#${e.id} · ${e.day}`), h('span', null, e.memo), e.reversalOf ? h('span', { class: 'chip' }, `reverses #${e.reversalOf}`) : null, e.voidedBy ? h('span', { class: 'chip' }, `voided by #${e.voidedBy}`) : null),
    h('div', { class: 'scroll' }, h('table', { class: 't' }, h('tbody', null, e.lines.map((l) => h('tr', null, h('td', null, `${l.code} ${l.name}`), h('td', null, l.debit ? $(l.debit) : ''), h('td', null, l.credit ? $(l.credit) : '')))))),
    !e.voidedBy && !e.reversalOf ? h('button', { class: 'danger', 'data-void': e.id, onclick: async () => { if (!confirm(`Void entry #${e.id}? A reversing entry will be posted.`)) return; try { await api('POST', `/entries/${e.id}/void`, {}); toast('Voided'); await route(); } catch (er) { toast(errText(er)); } } }, 'Void') : null)) : h('p', { class: 'empty' }, 'No entries yet.'));
}

async function newEntryView() {
  const accounts = (await api('GET', '/accounts')).filter((a) => !a.archived), date = h('input', { id: 'day', type: 'date', value: localToday() }), memo = h('input', { id: 'memo', maxlength: 200, placeholder: 'What happened?' }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' }), bal = h('p', { class: 'balance', id: 'balance' }), body = h('tbody');
  const lineRow = () => { const sel = h('select', { 'aria-label': 'Account' }, h('option', { value: '' }, 'Choose account…'), accounts.map((a) => h('option', { value: a.id }, `${a.code} ${a.name}`))), dr = h('input', { 'aria-label': 'Debit', inputmode: 'decimal', placeholder: '0.00' }), cr = h('input', { 'aria-label': 'Credit', inputmode: 'decimal', placeholder: '0.00' }); const tr = h('tr', null, h('td', null, sel), h('td', null, dr), h('td', null, cr)); tr._f = { sel, dr, cr }; for (const el of [sel, dr, cr]) el.addEventListener('input', recalc); return tr; };
  const collect = () => [...body.children].map((tr) => ({ account: tr._f.sel.value ? Number(tr._f.sel.value) : null, debit: tr._f.dr.value.trim(), credit: tr._f.cr.value.trim() }));
  function recalc() {
    const raw = collect(), parsed = raw.map((l) => ({ debit: l.debit ? parseMoney(l.debit) : 0, credit: l.credit ? parseMoney(l.credit) : 0 })).filter((l, i) => raw[i].debit || raw[i].credit || raw[i].account);
    if (parsed.some((l) => l.debit === null || l.credit === null)) { bal.textContent = 'Amounts must look like 12.50'; bal.className = 'balance off'; return; }
    const d = parsed.reduce((s, l) => s + l.debit, 0), c = parsed.reduce((s, l) => s + l.credit, 0); bal.textContent = d === c && d > 0 ? `Balanced · ${$(d)}` : `Debits ${$(d)} · Credits ${$(c)}${d !== c ? ` · off by ${$(Math.abs(d - c))}` : ''}`; bal.className = 'balance ' + (d === c && d > 0 ? 'ok' : 'off');
  }
  body.append(lineRow(), lineRow()); recalc();
  const save = async (ev) => { ev.preventDefault(); err.textContent = ''; const lines = collect().filter((l) => l.account || l.debit || l.credit); try { await api('POST', '/entries', { day: date.value, memo: memo.value, lines }); toast('Posted'); location.hash = '#/'; } catch (er) { err.textContent = errText(er); } };
  render(h('h1', null, 'New journal entry'), h('form', { onsubmit: save }, h('div', { class: 'row' }, h('div', null, h('label', { for: 'day' }, 'Date'), date), h('div', h('label', { for: 'memo' }, 'Memo'), memo)), h('div', { class: 'scroll lines' }, h('table', { class: 't' }, h('thead', null, th('Account', 'Debit', 'Credit')), body)), h('p', null, h('button', { type: 'button', id: 'add-line', onclick: () => { body.append(lineRow()); } }, 'Add line')), bal, err, h('p', null, h('button', { class: 'primary', id: 'post' }, 'Post entry'))));
}

async function accountsView() {
  const accts = await api('GET', '/accounts'), code = h('input', { id: 'acode', placeholder: '5400', size: 6 }), name = h('input', { id: 'aname', placeholder: 'Account name' }), type = h('select', { id: 'atype' }, ['asset', 'liability', 'equity', 'income', 'expense'].map((t) => h('option', { value: t }, t))), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
  const create = async (ev) => { ev.preventDefault(); err.textContent = ''; try { await api('POST', '/accounts', { code: code.value, name: name.value, type: type.value }); await route(); } catch (er) { err.textContent = errText(er); } };
  render(h('h1', null, 'Chart of accounts'), h('form', { class: 'card row', onsubmit: create }, code, name, type, h('button', { class: 'primary' }, 'Add account'), err),
    h('div', { class: 'scroll' }, h('table', { class: 't', id: 'accounts' }, h('thead', null, th('Account', 'Type', 'Balance', '')), h('tbody', null, accts.map((a) => h('tr', { 'data-code': a.code, class: a.archived ? 'void' : '' }, h('td', null, h('a', { href: `#/accounts/${a.id}` }, `${a.code} ${a.name}`)), h('td', null, a.type), h('td', null, $(a.balance)), h('td', null, h('button', { 'aria-label': `${a.archived ? 'Restore' : 'Archive'} ${a.name}`, onclick: async () => { await api('PATCH', `/accounts/${a.id}`, { archived: !a.archived }); await route(); } }, a.archived ? 'Restore' : 'Archive'))))))));
}
async function ledgerView(id) {
  const l = await api('GET', `/accounts/${id}/ledger`);
  render(h('h1', null, `${l.account.code} ${l.account.name}`), h('p', { class: 'meta' }, `${l.account.type} account — balance shown in its natural direction`), l.rows.length ? h('div', { class: 'scroll' }, h('table', { class: 't', id: 'ledger' }, h('thead', null, th('Date', 'Memo', 'Debit', 'Credit', 'Balance')), h('tbody', null, l.rows.map((r) => h('tr', null, h('td', null, r.day), h('td', { class: 'l' }, r.memo), h('td', null, r.debit ? $(r.debit) : ''), h('td', null, r.credit ? $(r.credit) : ''), h('td', null, $(r.balance))))))) : h('p', { class: 'empty' }, 'No activity.'), h('a', { href: '#/accounts' }, '← Accounts'));
}
async function reportsView(sp) {
  const to = sp.get('to') || localToday(), from = sp.get('from') || to.slice(0, 4) + '-01-01', tb = await api('GET', `/reports/trial-balance?to=${to}`), st = await api('GET', `/reports/statements?from=${from}&to=${to}`), fromI = h('input', { id: 'from', type: 'date', value: from }), toI = h('input', { id: 'to', type: 'date', value: to });
  const go = () => { location.hash = `#/reports?from=${fromI.value}&to=${toI.value}`; }; fromI.addEventListener('change', go); toI.addEventListener('change', go);
  const sect = (title, rows, total, totalLabel) => [h('tr', null, h('th', { class: 'l', colspan: 2 }, title)), rows.map((r) => h('tr', null, h('td', { class: 'l' }, `${r.code} ${r.name}`), h('td', null, $(r.amount)))), h('tr', { class: 'total' }, h('td', { class: 'l' }, totalLabel), h('td', null, $(total)))];
  const is = st.incomeStatement, bs = st.balanceSheet;
  render(h('h1', null, 'Reports'), h('div', { class: 'row' }, h('label', { for: 'from' }, 'From'), fromI, h('label', { for: 'to' }, 'To / as of'), toI),
    h('h2', null, 'Trial balance'), h('div', { class: 'scroll' }, h('table', { class: 't', id: 'trial' }, h('thead', null, th('Account', 'Debit', 'Credit')), h('tbody', null, tb.rows.map((r) => h('tr', null, h('td', null, `${r.code} ${r.name}`), h('td', null, r.debit ? $(r.debit) : ''), h('td', null, r.credit ? $(r.credit) : ''))), h('tr', { class: 'total' }, h('td', null, 'Total'), h('td', { id: 'tb-debit' }, $(tb.debit)), h('td', { id: 'tb-credit' }, $(tb.credit)))))), h('p', { id: 'tb-status', class: 'balance ' + (tb.balanced ? 'ok' : 'off') }, tb.balanced ? 'Debits equal credits ✓' : 'Out of balance!'),
    h('h2', null, `Income statement (${st.from} → ${st.to})`), h('table', { class: 't', id: 'income' }, h('tbody', null, sect('Income', is.income, is.totalIncome, 'Total income'), sect('Expenses', is.expenses, is.totalExpenses, 'Total expenses'), h('tr', { class: 'total' }, h('td', { class: 'l' }, 'Net income'), h('td', { id: 'net-income' }, $(is.netIncome))))),
    h('h2', null, `Balance sheet (as of ${st.to})`), h('table', { class: 't', id: 'sheet' }, h('tbody', null, sect('Assets', bs.assets, bs.totalAssets, 'Total assets'), sect('Liabilities', bs.liabilities, bs.totalLiabilities, 'Total liabilities'), sect('Equity', bs.equity, bs.totalEquity, 'Total equity'), h('tr', null, h('td', { class: 'l' }, 'Retained earnings (all time)'), h('td', null, $(bs.retainedEarnings))), h('tr', { class: 'total' }, h('td', { class: 'l' }, 'Liabilities + equity + earnings'), h('td', { id: 'sheet-total' }, $(bs.totalLiabilitiesAndEquity))))), h('p', { id: 'sheet-status', class: 'balance ' + (bs.balanced ? 'ok' : 'off') }, bs.balanced ? 'Assets = liabilities + equity ✓' : 'Out of balance!'));
}
let routing = Promise.resolve();
async function doRoute() {
  const [path, qs] = location.hash.slice(1).split('?'), parts = path.split('/').filter(Boolean), sp = new URLSearchParams(qs || '');
  for (const id of ['journal', 'new', 'accounts', 'reports']) document.getElementById('nav-' + id).removeAttribute('aria-current');
  const nav = (id) => document.getElementById('nav-' + id).setAttribute('aria-current', 'page');
  try {
    if (!parts.length) { nav('journal'); await journalView(); } else if (parts[0] === 'new') { nav('new'); await newEntryView(); }
    else if (parts[0] === 'accounts') { nav('accounts'); parts[1] ? await ledgerView(Number(parts[1])) : await accountsView(); } else if (parts[0] === 'reports') { nav('reports'); await reportsView(sp); }
    else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back'));
  } catch (e) { render(h('h1', null, 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
