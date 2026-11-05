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
const shortUrl = (code) => `${location.origin}/s/${code}`;
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Short link copied'); }
  catch { const t = h('textarea', { 'aria-hidden': 'true' }, text); document.body.append(t); t.select(); try { document.execCommand('copy') ? toast('Short link copied') : toast('Copy failed — select the link manually', 'error'); } finally { t.remove(); } }
}
const statusBadge = (l) => (l.disabled ? h('span', { class: 'badge off' }, 'disabled') : l.expired ? h('span', { class: 'badge off' }, 'expired') : h('span', { class: 'badge on' }, 'active'));

async function viewList() {
  const links = await api('/links'); const errs = {};
  const err = (k) => h('span', { class: 'err', role: 'alert', id: 'e-' + k });
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); const btn = $('#create'); btn.disabled = true;
    for (const k of ['url', 'slug', 'expiresOn', 'title']) $('#e-' + k).textContent = '';
    try { const l = await api('/links', { method: 'POST', body: { url: fd.url, slug: fd.slug || undefined, expiresOn: fd.expiresOn || undefined, title: fd.title } }); toast('Short link created'); await copy(shortUrl(l.code)).catch(() => {}); route(); }
    catch (x) { const d = x.details || { url: x.message }; for (const [k, v] of Object.entries(d)) { const el = $('#e-' + k); if (el) el.textContent = v; else toast(v, 'error'); } btn.disabled = false; $('.err:not(:empty)')?.closest('label')?.querySelector('input')?.focus(); } } },
    h('label', { class: 'f' }, 'Destination URL', h('input', { type: 'text', name: 'url', id: 'url', inputmode: 'url', placeholder: 'https://example.com/a/very/long/link', autocomplete: 'off' }), err('url')),
    h('div', { class: 'two' }, h('label', { class: 'f' }, 'Custom slug (optional)', h('input', { type: 'text', name: 'slug', id: 'slug', placeholder: 'my-link', maxlength: 32 }), err('slug')), h('label', { class: 'f' }, 'Expires on (optional)', h('input', { type: 'date', name: 'expiresOn', id: 'expiresOn', min: localToday() }), err('expiresOn'))),
    h('label', { class: 'f' }, 'Title (optional)', h('input', { type: 'text', name: 'title', id: 'title', maxlength: 100 }), err('title')), h('div', {}, h('button', { class: 'btn primary', id: 'create' }, 'Shorten')));
  const dlg = (l) => { const d = h('dialog', { 'aria-labelledby': 'dt' }, h('h2', { id: 'dt' }, `Delete /s/${l.code}?`), h('p', { class: 'muted' }, 'The link stops working and its analytics are removed.'), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-del', onclick: async () => { d.close(); try { await api('/links/' + l.id, { method: 'DELETE' }); toast('Link deleted'); route(); } catch (x) { toast(x.message, 'error'); } } }, 'Delete'), h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'))); d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); };
  render(h('h1', {}, 'Shorten a link'), h('div', { class: 'card' }, form),
    links.length ? h('div', { class: 'card' }, h('h2', {}, `Your links (${links.length})`), h('ul', { class: 'list' }, links.map((l) => h('li', { class: 'item', 'data-code': l.code },
      h('div', { class: 'row between' }, h('div', { class: 'grow' }, h('a', { class: 'short', href: shortUrl(l.code), target: '_blank', rel: 'noopener' }, shortUrl(l.code)), statusBadge(l), l.title ? h('div', {}, l.title) : null, h('div', { class: 'dest' }, l.url), l.expiresOn ? h('div', { class: 'small muted' }, 'Expires ' + l.expiresOn) : null),
        h('div', { class: 'row' }, h('strong', { class: 'clicks', 'aria-label': `${l.clicks} clicks` }, `${l.clicks} clicks`), h('button', { class: 'btn sm', 'aria-label': 'Copy ' + l.code, onclick: () => copy(shortUrl(l.code)) }, 'Copy'), h('a', { class: 'btn sm', href: '#/l/' + l.id }, 'Stats'),
          h('button', { class: 'btn sm', 'aria-label': (l.disabled ? 'Enable ' : 'Disable ') + l.code, onclick: async () => { try { await api('/links/' + l.id, { method: 'PATCH', body: { disabled: !l.disabled } }); toast(l.disabled ? 'Link enabled' : 'Link disabled'); route(); } catch (x) { toast(x.message, 'error'); } } }, l.disabled ? 'Enable' : 'Disable'),
          h('button', { class: 'btn sm danger', 'aria-label': 'Delete ' + l.code, onclick: () => dlg(l) }, 'Delete')))))))
      : h('div', { class: 'card empty' }, 'No links yet. Paste a URL above to create your first short link.'));
}

function barChart(days) {
  const W = 600, H = 120, bw = W / days.length, max = Math.max(1, ...days.map((d) => d.clicks));
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H + 16}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Clicks per day, last 30 days');
  days.forEach((d, i) => { const ht = (d.clicks / max) * H, r = document.createElementNS(NS, 'rect'); for (const [k, v] of Object.entries({ class: 'bar', x: i * bw + 1, y: H - ht, width: bw - 2, height: ht, rx: 2 })) r.setAttribute(k, v); const t = document.createElementNS(NS, 'title'); t.textContent = `${d.day}: ${d.clicks} click${d.clicks === 1 ? '' : 's'}`; r.append(t); svg.append(r); });
  for (const [i, anchor] of [[0, 'start'], [days.length - 1, 'end']]) { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', i === 0 ? 0 : W); t.setAttribute('y', H + 12); t.setAttribute('text-anchor', anchor); t.textContent = days[i].day.slice(5); svg.append(t); }
  return svg;
}
async function viewStats(id) {
  const a = await api('/links/' + id), stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, l));
  const table = (rows, key, head) => h('table', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, head), h('th', { scope: 'col', class: 'num' }, 'Clicks'))), h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r[key]), h('td', { class: 'num' }, String(r.n))))));
  render(h('a', { href: '#/', class: 'small muted' }, '← All links'), h('h1', {}, a.title || `/s/${a.code}`), h('p', {}, h('a', { class: 'short', href: shortUrl(a.code), target: '_blank', rel: 'noopener' }, shortUrl(a.code)), statusBadge(a), h('br'), h('span', { class: 'dest' }, '→ ' + a.url)),
    h('div', { class: 'grid' }, stat(a.humanClicks, 'Human clicks'), stat(a.botClicks, 'Bot / preview clicks'), stat(a.days.slice(-7).reduce((s, d) => s + d.clicks, 0), 'Last 7 days'), stat(a.expiresOn ?? 'never', 'Expires')),
    h('div', { class: 'card' }, h('h2', {}, 'Clicks per day (last 30 days, bots excluded)'), barChart(a.days)),
    h('div', { class: 'two card' }, h('div', {}, h('h2', {}, 'Top referrers'), a.referrers.length ? table(a.referrers, 'name', 'Source') : h('p', { class: 'muted' }, 'No clicks yet.')), h('div', {}, h('h2', {}, 'Devices'), a.devices.length ? table(a.devices, 'device', 'Type') : h('p', { class: 'muted' }, 'No clicks yet.'))));
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const hash = location.hash.slice(1) || '/'; let m;
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewList(); else if ((m = hash.match(/^\/l\/(\d+)$/))) await viewStats(m[1]);
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) render(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to links')));
    else render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
