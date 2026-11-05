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
const s = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
const toast = (m, t = '') => { const e = h('div', { class: 'toast ' + t }, m); $('#toasts').append(e); setTimeout(() => e.remove(), 3500); };
class ApiError extends Error { constructor(m, d, st) { super(m); this.details = d; this.status = st; } }
async function api(path, opts = {}) {
  let res;
  try { res = await fetch('/api' + path, { method: opts.method, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new ApiError('Network error — check your connection and try again.', null, 0); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, data.details, res.status);
  return data;
}
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 }));

function barChart(items, label, W = 640, L = 150) {
  const rowH = 24, H = items.length * rowH + 4, max = Math.max(...items.map((i) => i.value ?? 0), 1e-9);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  items.forEach((it, i) => {
    const w = Math.max(0, ((it.value ?? 0) / max) * (W - L - 50));
    const y = i * rowH + 2, t = s('title', {}, `${it.key}: ${fmt(it.value)}`);
    const r = s('rect', { class: 'b', x: L, y: y + 3, width: w, height: rowH - 8, rx: 3 }); r.append(t);
    svg.append(s('text', { x: L - 6, y: y + 15, 'text-anchor': 'end' }, it.key.length > (L > 100 ? 22 : 12) ? it.key.slice(0, L > 100 ? 21 : 11) + '…' : it.key), r, s('text', { x: L + w + 5, y: y + 15 }, fmt(it.value)));
  });
  return svg;
}
function histogram(hist) {
  const W = 300, H = 90, max = Math.max(...hist.map((b) => b.count), 1), bw = W / hist.length;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H + 14}`, role: 'img', 'aria-label': 'Histogram' });
  hist.forEach((b, i) => { const ht = (b.count / max) * H, r = s('rect', { class: 'b', x: i * bw + 1, y: H - ht, width: bw - 2, height: ht }); r.append(s('title', {}, `${fmt(b.from)} – ${fmt(b.to)}: ${b.count}`)); svg.append(r); });
  svg.append(s('text', { x: 0, y: H + 11 }, fmt(hist[0].from)), s('text', { x: W, y: H + 11, 'text-anchor': 'end' }, fmt(hist.at(-1).to)));
  return svg;
}

async function viewList() {
  const list = await api('/datasets');
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); const btn = $('#upload'); btn.disabled = true;
    try { const d = await api('/datasets', { method: 'POST', body: { name: fd.name, csv: fd.csv } }); toast('Dataset imported'); location.hash = '#/d/' + d.id; }
    catch (x) { $('#nerr').textContent = x.details?.name || ''; $('#cerr').textContent = x.details?.csv || (x.details ? '' : x.message); btn.disabled = false; }
  } },
    h('label', {}, 'Name', h('input', { name: 'name', id: 'name', maxlength: 100 }), h('span', { class: 'err', id: 'nerr', role: 'alert' })),
    h('label', {}, 'Paste CSV or choose a file', h('textarea', { name: 'csv', id: 'csv', placeholder: 'city,sales\nParis,10' }), h('span', { class: 'err', id: 'cerr', role: 'alert' })),
    h('div', { class: 'row' }, h('input', { type: 'file', id: 'file', accept: '.csv,.tsv,.txt,text/csv', 'aria-label': 'CSV file', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 5e6) { $('#cerr').textContent = 'File too large (max 5 MB)'; return; } $('#csv').value = await f.text(); if (!$('#name').value) $('#name').value = f.name.replace(/\.\w+$/, ''); } }),
      h('button', { class: 'btn primary', id: 'upload' }, 'Analyze')));
  const dlg = h('dialog', { 'aria-labelledby': 'dt' }, h('h2', { id: 'dt' }, 'Delete this dataset?'), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-del' }, 'Delete'), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
  main.replaceChildren(h('h1', {}, 'Datasets'), h('div', { class: 'card' }, h('h2', {}, 'Import data'), form),
    list.length ? h('div', { class: 'card' }, h('ul', { class: 'list' }, list.map((d) => h('li', { class: 'item' },
      h('div', {}, h('a', { href: '#/d/' + d.id }, h('strong', {}, d.name)), h('div', { class: 'small muted' }, `${d.rowCount.toLocaleString()} rows · ${d.columnCount} columns`)),
      h('button', { class: 'btn danger', 'aria-label': 'Delete ' + d.name, onclick: () => { $('#confirm-del', dlg).onclick = async () => { try { await api('/datasets/' + d.id, { method: 'DELETE' }); dlg.close(); toast('Dataset deleted'); route(); } catch (x) { dlg.close(); toast(x.message, 'error'); } }; dlg.showModal(); } }, 'Delete')))))
      : h('div', { class: 'card empty' }, 'No datasets yet. Paste or upload a CSV above.'), dlg);
}

async function viewDataset(id) {
  const info = await api('/datasets/' + id);
  let tab = 'profile';
  const body = h('div'), tabs = h('div', { class: 'tabs', role: 'tablist' });
  const draw = () => {
    tabs.replaceChildren(...[['profile', 'Profile'], ['data', 'Data'], ['chart', 'Chart']].map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(tab === k), id: 'tab-' + k, onclick: () => { tab = k; draw(); } }, l)));
    body.replaceChildren(); ({ profile, data, chart })[tab]();
  };
  const profile = () => body.append(h('div', { class: 'cols' }, info.columns.map((c) => h('div', { class: 'card col-card' },
    h('h3', {}, c.name, h('span', { class: 'tag' }, c.type)),
    h('dl', {}, [['Missing', `${c.nulls} (${Math.round((c.nulls / c.count) * 100)}%)`], ['Unique', fmt(c.unique)],
      ...(c.type === 'number' ? [['Min', fmt(c.min)], ['Median', fmt(c.median)], ['Mean', fmt(c.mean)], ['Max', fmt(c.max)], ['Std dev', fmt(c.std)]] : []),
      ...(c.type === 'date' ? [['Earliest', c.min], ['Latest', c.max]] : [])].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))])),
    c.type === 'number' ? histogram(c.hist) : c.top.length ? barChart(c.top.map((t) => ({ key: t.value, value: t.count })), 'Top values of ' + c.name, 300, 90) : null))));
  const data = () => {
    const st = { offset: 0, q: '', sort: '', dir: 'asc' }, out = h('div'); let t;
    const load = async () => {
      try {
        const qs = new URLSearchParams({ offset: st.offset, limit: 25, q: st.q, ...(st.sort ? { sort: st.sort, dir: st.dir } : {}) });
        const r = await api(`/datasets/${id}/rows?${qs}`);
        const head = h('tr', {}, info.columns.map((c) => h('th', { scope: 'col', 'aria-sort': st.sort === c.name ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
          h('button', { onclick: () => { st.dir = st.sort === c.name && st.dir === 'asc' ? 'desc' : 'asc'; st.sort = c.name; st.offset = 0; load(); } }, c.name + (st.sort === c.name ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '')))));
        const trs = r.rows.map((row) => h('tr', {}, info.columns.map((c) => h('td', { title: row[c.name] }, row[c.name]))));
        const table = h('table', {}, h('thead', {}, head), h('tbody', {}, trs));
        const pager = h('div', { class: 'row between' },
          h('span', { class: 'muted small', id: 'rowinfo' }, `${r.total ? st.offset + 1 : 0}–${Math.min(st.offset + 25, r.total)} of ${r.total.toLocaleString()}`),
          h('div', { class: 'row' },
            h('button', { class: 'btn', id: 'prev', disabled: st.offset === 0, onclick: () => { st.offset -= 25; load(); } }, 'Previous'),
            h('button', { class: 'btn', id: 'next', disabled: st.offset + 25 >= r.total, onclick: () => { st.offset += 25; load(); } }, 'Next')));
        out.replaceChildren(h('div', { class: 'tablewrap' }, table), r.rows.length ? null : h('p', { class: 'empty' }, 'No rows match.'), pager);
      } catch (x) { out.replaceChildren(h('div', { class: 'banner', role: 'alert' }, x.message, ' ', h('button', { class: 'btn', onclick: load }, 'Retry'))); }
    };
    body.append(h('input', { type: 'search', id: 'search', placeholder: 'Search all columns…', 'aria-label': 'Search rows', oninput: (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.offset = 0; load(); }, 200); } }), h('p'), out); load();
  };
  const chart = () => {
    const cols = info.columns, nums = cols.filter((c) => c.type === 'number'), out = h('div');
    const g = h('select', { id: 'group', 'aria-label': 'Group by' }, cols.map((c) => h('option', { value: c.name }, c.name)));
    const fn = h('select', { id: 'fn', 'aria-label': 'Aggregate' }, ['count', 'sum', 'avg', 'min', 'max'].map((f) => h('option', { value: f, disabled: f !== 'count' && !nums.length }, f)));
    const m = h('select', { id: 'metric', 'aria-label': 'Metric column' }, nums.map((c) => h('option', { value: c.name }, c.name)));
    const run = async () => {
      m.disabled = fn.value === 'count';
      try {
        const qs = new URLSearchParams({ group: g.value, fn: fn.value, ...(fn.value !== 'count' ? { metric: m.value } : {}) });
        const r = await api(`/datasets/${id}/aggregate?${qs}`);
        out.replaceChildren(h('div', { class: 'card' }, h('h2', {}, `${fn.value}${fn.value === 'count' ? '' : ' of ' + m.value} by ${g.value}`), r.length ? barChart(r.slice(0, 20), 'Aggregate chart') : 'No data', r.length > 20 ? h('p', { class: 'muted small' }, `Showing top 20 of ${r.length} groups.`) : null));
      } catch (x) { out.replaceChildren(h('div', { class: 'banner', role: 'alert' }, x.message)); }
    };
    [g, fn, m].forEach((e) => e.addEventListener('change', run));
    body.append(h('div', { class: 'card' }, h('div', { class: 'grid3' }, h('label', {}, 'Group by', g), h('label', {}, 'Aggregate', fn), h('label', {}, 'Metric', m))), out); run();
  };
  main.replaceChildren(h('div', { class: 'row between' }, h('div', {}, h('a', { href: '#/', class: 'small muted' }, '← All datasets'), h('h1', {}, info.name), h('p', { class: 'muted' }, `${info.rowCount.toLocaleString()} rows · ${info.columns.length} columns · delimiter ${info.delimiter === '\t' ? 'tab' : '"' + info.delimiter + '"'}`))), tabs, body);
  draw();
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const hash = location.hash.slice(1) || '/'; let m;
  main.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewList(); else if ((m = hash.match(/^\/d\/(\d+)$/))) await viewDataset(m[1]);
    else main.replaceChildren(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) main.replaceChildren(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to datasets')));
    else main.replaceChildren(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
