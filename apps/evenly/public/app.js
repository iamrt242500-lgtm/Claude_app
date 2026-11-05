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
const money = (c, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(c / 100);
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const field = (label, ctl, err) => h('label', { class: 'f' }, label, ctl, err && h('span', { class: 'err', role: 'alert' }, err));
const confirmDialog = (title, onOk) => { const dlg = h('dialog', { 'aria-labelledby': 'cdt' }, h('h2', { id: 'cdt' }, title), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-ok', onclick: async () => { dlg.close(); await onOk(); } }, 'Delete'), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel'))); dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal(); };

async function viewGroups() {
  const groups = await api('/groups'); let errs = {};
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
    try { const g = await api('/groups', { method: 'POST', body: { name: fd.name, currency: fd.currency, members: fd.members.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) } }); toast('Group created'); location.hash = '#/g/' + g.id; }
    catch (x) { errs = x.details || { name: x.message }; for (const k of ['name', 'members', 'currency']) $('#e-' + k).textContent = errs[k] || ''; } } },
    h('div', { class: 'three' }, h('label', { class: 'f' }, 'Group name', h('input', { type: 'text', name: 'name', id: 'group-name', maxlength: 80, placeholder: 'e.g. Lisbon trip' }), h('span', { class: 'err', id: 'e-name', role: 'alert' })),
      h('label', { class: 'f' }, 'Currency', h('select', { name: 'currency' }, ['USD', 'EUR', 'GBP'].map((c) => h('option', { value: c }, c))), h('span', { class: 'err', id: 'e-currency', role: 'alert' }))),
    h('label', { class: 'f' }, 'People (one per line or comma separated)', h('textarea', { name: 'members', id: 'group-members', placeholder: 'Ann\nBob\nCy' }), h('span', { class: 'err', id: 'e-members', role: 'alert' })),
    h('div', {}, h('button', { class: 'btn primary', id: 'create-group' }, 'Create group')));
  render(h('h1', {}, 'Your groups'), h('div', { class: 'card' }, h('h2', {}, 'New group'), form),
    groups.length ? h('div', { class: 'card' }, h('ul', { class: 'list' }, groups.map((g) => h('li', { class: 'item' }, h('div', {}, h('a', { href: '#/g/' + g.id }, h('strong', {}, g.name)), h('div', { class: 'small muted' }, `${g.members} people`)), h('span', { class: 'num' }, money(g.total, g.currency)))))) : h('div', { class: 'card empty' }, 'No groups yet. Create one above.'));
}

async function viewGroup(id) {
  let g = await api('/groups/' + id);
  const name = (mid) => g.members.find((m) => m.id === Number(mid))?.name ?? '?';
  const set = async (p) => { try { g = await p; draw(); } catch (x) { toast(x.details ? Object.values(x.details)[0] : x.message, 'error'); throw x; } };
  let editing = null, split = { type: 'equal' };

  function expenseForm() {
    const e = editing; const state = { type: e ? (e.splitType === 'equal' ? 'equal' : 'exact') : split.type, errs: {} };
    const initEqual = e && e.splitType === 'equal' ? Object.keys(e.shares).map(Number) : g.members.map((m) => m.id);
    const initVals = e ? Object.fromEntries(Object.entries(e.shares).map(([k, v]) => [k, (v / 100).toFixed(2)])) : {};
    const form = h('form', { novalidate: true, id: 'expense-form' }), box = h('div'), helper = h('div', { class: 'small', id: 'split-helper', 'aria-live': 'polite' });
    const val = (mid) => $(`[data-val="${mid}"]`, form)?.value ?? ''; const checked = (mid) => $(`[data-chk="${mid}"]`, form)?.checked;
    const total = () => { const v = Number(String($('[name=amount]', form)?.value || '0').replace(/,/g, '')); return Number.isFinite(v) ? Math.round(v * 100) : 0; };
    const updateHelper = () => {
      if (state.type === 'exact') { const sum = g.members.reduce((s, m) => s + Math.round((Number(val(m.id)) || 0) * 100), 0), diff = total() - sum; helper.className = 'small ' + (diff === 0 && total() > 0 ? 'ok' : 'muted'); helper.textContent = diff === 0 && total() > 0 ? 'Amounts match the total ✓' : `${money(Math.abs(diff), g.currency)} ${diff > 0 ? 'left to assign' : 'over the total'}`; }
      else if (state.type === 'percent') { const sum = g.members.reduce((s, m) => s + (Number(val(m.id)) || 0), 0); helper.className = 'small ' + (Math.abs(sum - 100) < 0.001 ? 'ok' : 'muted'); helper.textContent = Math.abs(sum - 100) < 0.001 ? 'Percentages add up to 100 ✓' : `${Math.round((100 - sum) * 100) / 100}% remaining`; }
      else if (state.type === 'equal') { const n = g.members.filter((m) => checked(m.id)).length; helper.className = 'small muted'; helper.textContent = n ? `${n} ${n === 1 ? 'person' : 'people'}, about ${money(Math.round(total() / n), g.currency)} each` : 'Choose at least one person'; }
      else { helper.className = 'small muted'; helper.textContent = 'Shares are relative weights (e.g. 2 and 1 → two thirds / one third)'; }
    };
    const drawSplit = () => {
      box.replaceChildren(...g.members.map((m) => state.type === 'equal'
        ? h('div', { class: 'splitrow' }, h('label', {}, h('input', { type: 'checkbox', 'data-chk': m.id, checked: initEqual.includes(m.id), oninput: updateHelper }), m.name))
        : h('div', { class: 'splitrow' }, h('label', { for: 'v' + m.id }, m.name), h('input', { type: 'text', inputmode: 'decimal', id: 'v' + m.id, 'data-val': m.id, value: state.type === 'exact' ? (initVals[m.id] ?? '') : '', placeholder: state.type === 'percent' ? '%' : state.type === 'shares' ? '1' : '0.00', oninput: updateHelper }))));
      updateHelper();
    };
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Split method' }, [['equal', 'Equally'], ['shares', 'By shares'], ['percent', 'By %'], ['exact', 'Exact amounts']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(state.type === k), 'data-split': k, onclick: () => { state.type = k; split.type = k; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.split === k))); drawSplit(); } }, l)));
    form.append(
      h('div', { class: 'three' }, field('Description', h('input', { type: 'text', name: 'description', value: e?.description ?? '', maxlength: 120, placeholder: 'e.g. Dinner' }), null), field('Amount', h('input', { type: 'text', inputmode: 'decimal', name: 'amount', value: e ? (e.amount / 100).toFixed(2) : '', placeholder: '0.00', oninput: updateHelper }), null)),
      h('div', { class: 'two' }, field('Paid by', h('select', { name: 'paidBy' }, g.members.map((m) => h('option', { value: m.id, selected: e ? m.id === e.paidBy : false }, m.name))), null), field('Date', h('input', { type: 'date', name: 'day', value: e?.day ?? localToday() }), null)),
      h('div', { class: 'f' }, h('span', { class: 'small' }, 'Split'), seg), box, helper, h('div', { class: 'err', id: 'expense-err', role: 'alert' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'save-expense' }, e ? 'Save expense' : 'Add expense'), e && h('button', { type: 'button', class: 'btn', onclick: () => { editing = null; draw(); } }, 'Cancel')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const fd = Object.fromEntries(new FormData(form));
      const spec = state.type === 'equal' ? { type: 'equal', members: g.members.filter((m) => checked(m.id)).map((m) => m.id) } : { type: state.type, values: Object.fromEntries(g.members.map((m) => [m.id, val(m.id)])) };
      $('#save-expense').disabled = true;
      try { g = await api(e ? `/groups/${id}/expenses/${e.id}` : `/groups/${id}/expenses`, { method: e ? 'PUT' : 'POST', body: { description: fd.description, amount: fd.amount, paidBy: Number(fd.paidBy), day: fd.day, split: spec } }); toast(e ? 'Expense saved' : 'Expense added'); editing = null; draw(); }
      catch (x) { $('#expense-err').textContent = x.details ? Object.values(x.details).join(' · ') : x.message; $('#save-expense').disabled = false; }
    });
    drawSplit(); return form;
  }

  function draw() {
    render(h('a', { href: '#/', class: 'small muted' }, '← Groups'),
      h('div', { class: 'row between' }, h('h1', {}, g.name), h('button', { class: 'btn sm danger', id: 'del-group', onclick: () => confirmDialog(`Delete "${g.name}" and all its expenses?`, async () => { try { await api('/groups/' + id, { method: 'DELETE' }); toast('Group deleted'); location.hash = '#/'; } catch (x) { toast(x.message, 'error'); } }) }, 'Delete group')),
      h('div', { class: 'card stat' }, h('div', {}, h('b', { id: 'total' }, money(g.total, g.currency)), h('span', { class: 'muted small' }, 'Total spent')), h('div', {}, h('b', {}, String(g.expenses.length)), h('span', { class: 'muted small' }, 'Expenses')), h('div', {}, h('b', {}, String(g.members.length)), h('span', { class: 'muted small' }, 'People'))),
      h('div', { class: 'card' }, h('h2', {}, editing ? 'Edit expense' : 'Add an expense'), expenseForm()),
      h('div', { class: 'card' }, h('h2', {}, 'Balances'), h('ul', { class: 'list', id: 'balances' }, g.members.map((m) => { const b = g.balances[m.id]; return h('li', { class: 'item' }, h('span', {}, m.name), h('span', { class: 'num ' + (b > 0 ? 'pos' : b < 0 ? 'neg' : 'muted') }, b === 0 ? 'settled up' : b > 0 ? `gets back ${money(b, g.currency)}` : `owes ${money(-b, g.currency)}`)); }))),
      h('div', { class: 'card' }, h('h2', {}, 'Settle up'), g.suggestions.length ? h('ul', { class: 'list', id: 'suggestions' }, g.suggestions.map((s) => h('li', { class: 'item' }, h('span', {}, h('strong', {}, name(s.from)), ' pays ', h('strong', {}, name(s.to)), ' ', h('span', { class: 'num' }, money(s.amount, g.currency))),
        h('button', { class: 'btn sm primary', 'data-pay': `${s.from}-${s.to}`, onclick: () => set(api(`/groups/${id}/settlements`, { method: 'POST', body: { from: s.from, to: s.to, amount: (s.amount / 100).toFixed(2), day: localToday() } })).then(() => toast('Payment recorded')).catch(() => {}) }, 'Record payment')))) : h('p', { class: 'empty', id: 'all-settled' }, g.expenses.length ? 'Everyone is settled up 🎉' : 'Add an expense to get started.')),
      h('div', { class: 'card' }, h('h2', {}, 'Expenses'), g.expenses.length ? h('ul', { class: 'list' }, g.expenses.map((e) => h('li', { class: 'item', 'data-expense': e.id }, h('div', {}, h('strong', {}, e.description), h('div', { class: 'small muted' }, `${e.day} · paid by ${name(e.paidBy)} · split ${Object.keys(e.shares).length} way${Object.keys(e.shares).length === 1 ? '' : 's'}`)),
        h('div', { class: 'row' }, h('span', { class: 'num' }, money(e.amount, g.currency)), h('button', { class: 'btn sm', 'aria-label': 'Edit ' + e.description, onclick: () => { editing = e; draw(); scrollTo(0, 0); } }, 'Edit'),
          h('button', { class: 'btn sm danger', 'aria-label': 'Delete ' + e.description, onclick: () => confirmDialog(`Delete "${e.description}"?`, () => set(api(`/groups/${id}/expenses/${e.id}`, { method: 'DELETE' })).then(() => toast('Expense deleted')).catch(() => {})) }, 'Delete'))))) : h('p', { class: 'empty' }, 'No expenses yet.')),
      g.settlements.length ? h('div', { class: 'card' }, h('h2', {}, 'Payments'), h('ul', { class: 'list' }, g.settlements.map((s) => h('li', { class: 'item' }, h('span', {}, `${s.day} · ${name(s.from)} paid ${name(s.to)}`), h('div', { class: 'row' }, h('span', { class: 'num' }, money(s.amount, g.currency)), h('button', { class: 'btn sm', 'aria-label': 'Undo payment', onclick: () => set(api(`/groups/${id}/settlements/${s.id}`, { method: 'DELETE' })).then(() => toast('Payment removed')).catch(() => {}) }, 'Undo')))))) : null,
      h('div', { class: 'card' }, h('h2', {}, 'People'), h('ul', { class: 'list' }, g.members.map((m) => h('li', { class: 'item' }, h('span', {}, m.name), h('button', { class: 'btn sm', 'aria-label': 'Remove ' + m.name, onclick: () => set(api(`/groups/${id}/members/${m.id}`, { method: 'DELETE' })).then(() => toast('Person removed')).catch(() => {}) }, 'Remove')))),
        h('form', { class: 'row', novalidate: true, onsubmit: async (e) => { e.preventDefault(); try { g = await api(`/groups/${id}/members`, { method: 'POST', body: { name: new FormData(e.target).get('name') } }); toast('Person added'); draw(); } catch (x) { $('#member-err').textContent = x.details?.name || x.message; } } },
          h('input', { type: 'text', name: 'name', id: 'member-name', 'aria-label': 'New person name', placeholder: 'Add a person', maxlength: 40 }), h('button', { class: 'btn' }, 'Add'), h('span', { class: 'err', id: 'member-err', role: 'alert' }))));
  }
  draw();
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const hash = location.hash.slice(1) || '/'; let m;
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewGroups(); else if ((m = hash.match(/^\/g\/(\d+)$/))) await viewGroup(m[1]);
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) render(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to groups')));
    else render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
