const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; throw e; } return j;
}
const errText = (e) => (e.details ? Object.values(e.details).join(' · ') : e.message), LABEL = { winners: 'Pick winners', groups: 'Make groups', santa: 'Secret Santa' };

function newView(sp) {
  const kind = ['winners', 'groups', 'santa'].includes(sp.get('kind')) ? sp.get('kind') : 'winners';
  const title = h('input', { id: 'title', maxlength: 80, placeholder: 'optional' }), entries = h('textarea', { id: 'entries', rows: 9, placeholder: 'One name per line.\nAdd a weight with "x3": Ann x3' }), seed = h('input', { id: 'seed', placeholder: 'leave empty for a random seed', maxlength: 100 }), count = h('input', { id: 'count', type: 'number', min: 1, max: 100, value: 1 }), groups = h('input', { id: 'groups', type: 'number', min: 2, max: 50, value: 2 }), ring = h('input', { id: 'ring', type: 'checkbox', checked: true }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' }), tally = h('p', { class: 'meta', id: 'tally' });
  const upd = () => { const n = entries.value.split('\n').filter((l) => l.trim()).length; tally.textContent = `${n} line${n === 1 ? '' : 's'}`; }; entries.addEventListener('input', upd); upd();
  const params = () => (kind === 'winners' ? { count: Number(count.value) } : kind === 'groups' ? { groups: Number(groups.value) } : { ring: ring.checked });
  render(h('h1', null, 'New draw'), h('div', { class: 'tabs' }, Object.entries(LABEL).map(([k, l]) => h('a', { href: `#/?kind=${k}`, 'aria-current': k === kind ? 'page' : null, 'data-kind': k }, l))),
    h('form', { onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; try { const d = await api('POST', '/draws', { kind, title: title.value, entries: entries.value, seed: seed.value, params: params() }); location.hash = `#/draw/${d.id}`; } catch (e) { err.textContent = errText(e); } } },
      h('label', { for: 'title' }, 'Title'), title, h('label', { for: 'entries' }, 'Entries'), entries, tally,
      kind === 'winners' ? [h('label', { for: 'count' }, 'Number of winners'), count] : null, kind === 'groups' ? [h('label', { for: 'groups' }, 'Number of groups'), groups] : null, kind === 'santa' ? h('label', null, ring, ' One big circle (everyone gives to the next person)') : null,
      h('label', { for: 'seed' }, 'Seed (optional — anyone with the same seed and list gets the same result)'), seed, err, h('p', null, h('button', { class: 'primary', id: 'draw' }, 'Draw'))));
}
async function drawView(id) {
  const d = await api('GET', `/draws/${id}`), shown = new Set(); const body = h('div', { id: 'result' }), ver = h('p', { id: 'verify' });
  const paint = () => {
    body.replaceChildren();
    if (d.kind === 'winners') add(body, [h('ol', { id: 'winners' }, d.result.winners.map((w, i) => h('li', { class: 'winner', 'data-place': i + 1 }, w)))]);
    else if (d.kind === 'groups') add(body, [h('div', { class: 'groups', id: 'groups' }, d.result.groups.map((g, i) => h('div', { class: 'card', 'data-group': i + 1 }, h('strong', null, `Group ${i + 1} (${g.length})`), h('ul', null, g.map((n) => h('li', null, n))))))]);
    else add(body, [h('p', { class: 'meta' }, 'Pass the device around: each person taps their own name.'), h('div', { id: 'santa' }, Object.entries(d.result.pairs).map(([from, to]) => h('div', { class: 'card row', 'data-from': from }, h('strong', null, from), shown.has(from) ? h('span', { class: 'winner', 'data-to': to }, `→ ${to}`) : h('button', { 'data-reveal': from, onclick: () => { shown.add(from); paint(); } }, 'Reveal'), shown.has(from) ? h('button', { onclick: () => { shown.delete(from); paint(); } }, 'Hide') : null)))]);
  };
  paint();
  render(h('h1', null, d.title), h('p', { class: 'meta' }, `${LABEL[d.kind]} · ${d.entries.split('\n').filter((l) => l.trim()).length} entries · ${d.createdAt} UTC`), body,
    h('h2', null, 'Proof'), h('p', null, 'Seed: ', h('code', { id: 'seed-value' }, d.seed)), h('p', { class: 'meta' }, 'Same list + same seed + same settings always gives this exact result. Check it:'), h('p', null, h('button', { id: 'verify-btn', onclick: async () => { const v = await api('GET', `/draws/${id}/verify`); ver.className = v.matches ? 'ok' : 'bad'; ver.textContent = v.matches ? '✓ Re-computed from the seed: identical result.' : '✗ The stored result does not match the seed!'; } }, 'Verify this draw')), ver,
    h('p', null, h('a', { href: '#/history' }, '← History'), ' ', h('button', { class: 'danger', id: 'delete', onclick: async () => { if (!confirm('Delete this draw?')) return; await api('DELETE', `/draws/${id}`); location.hash = '#/history'; } }, 'Delete')));
}
async function historyView() {
  const list = await api('GET', '/draws');
  render(h('h1', null, 'History'), list.length ? list.map((d) => h('a', { class: 'card', href: `#/draw/${d.id}`, 'data-draw': d.title }, h('strong', null, d.title), h('div', { class: 'meta' }, `${LABEL[d.kind]} · ${d.entryCount} entries · ${d.createdAt}`))) : h('p', { class: 'empty' }, 'No draws yet.'));
}
let routing = Promise.resolve();
async function doRoute() {
  const [path, qs] = location.hash.slice(1).split('?'), parts = path.split('/').filter(Boolean), sp = new URLSearchParams(qs || ''); document.getElementById('nav-new').removeAttribute('aria-current'); document.getElementById('nav-history').removeAttribute('aria-current');
  try { if (!parts.length) { document.getElementById('nav-new').setAttribute('aria-current', 'page'); newView(sp); } else if (parts[0] === 'draw' && parts[1]) await drawView(Number(parts[1])); else if (parts[0] === 'history') { document.getElementById('nav-history').setAttribute('aria-current', 'page'); await historyView(); } else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back')); }
  catch (e) { render(h('h1', null, e.status === 404 ? 'Not found' : 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
