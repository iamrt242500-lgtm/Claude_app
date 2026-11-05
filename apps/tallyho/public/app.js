const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; throw e; } return j;
}
const errText = (e) => (e.details ? Object.values(e.details).join(' · ') : e.message);
const roundName = (r, rounds) => { const left = rounds - r; return left === 1 ? 'Final' : left === 2 ? 'Semifinals' : left === 3 ? 'Quarterfinals' : `Round of ${2 ** left}`; };

async function listView() {
  const ts = await api('GET', '/tournaments');
  render(h('h1', null, 'Tournaments'), ts.length ? ts.map((t) => h('a', { class: 'card', href: `#/t/${t.id}`, 'data-t': t.id }, h('strong', null, t.name), h('div', { class: 'meta' }, h('span', null, t.format === 'knockout' ? 'Knockout' : 'Round robin'), h('span', null, `${t.players} players`), h('span', null, `${t.progress.played}/${t.progress.total} played`), t.champion ? h('span', { class: 'chip' }, `🏆 ${t.champion}`) : null))) : h('p', { class: 'empty' }, 'No tournaments yet.'), h('a', { class: 'btn primary', href: '#/new' }, 'New tournament'));
}
function newView() {
  const name = h('input', { id: 'tname', maxlength: 60 }), fmt = h('select', { id: 'tformat' }, h('option', { value: 'knockout' }, 'Knockout (single elimination)'), h('option', { value: 'roundrobin' }, 'Round robin (everyone plays everyone)')), players = h('textarea', { id: 'tplayers', rows: 8, placeholder: 'One player per line. For a knockout, the order is the seeding (top = seed 1).' }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' }), count = h('span', { class: 'meta', id: 'pcount' });
  const upd = () => { const n = players.value.split('\n').map((s) => s.trim()).filter(Boolean).length; count.textContent = `${n} player${n === 1 ? '' : 's'}`; }; players.addEventListener('input', upd); upd();
  render(h('h1', null, 'New tournament'), h('form', { onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; try { const t = await api('POST', '/tournaments', { name: name.value, format: fmt.value, players: players.value }); location.hash = `#/t/${t.id}`; } catch (e) { err.textContent = errText(e); } } }, h('label', { for: 'tname' }, 'Name'), name, h('label', { for: 'tformat' }, 'Format'), fmt, h('label', { for: 'tplayers' }, 'Players'), players, count, err, h('p', null, h('button', { class: 'primary', id: 'create' }, 'Create'))));
}

async function tourView(id) {
  const load = async () => draw(await api('GET', `/tournaments/${id}`));
  function matchCard(t, m) {
    const name = (i) => (i === null ? (m.round === 0 && t.format === 'knockout' ? 'BYE' : 'TBD') : t.players[i]), ready = m.a !== null && m.b !== null && !m.bye, played = m.sa !== null;
    const sa = h('input', { type: 'number', min: 0, max: 999, value: m.sa ?? '', 'aria-label': `Score ${name(m.a)}`, 'data-score': 'a' }), sb = h('input', { type: 'number', min: 0, max: 999, value: m.sb ?? '', 'aria-label': `Score ${name(m.b)}`, 'data-score': 'b' });
    const save = async () => { if (sa.value === '' || sb.value === '') return toast('Enter both scores'); try { await api('PUT', `/tournaments/${id}/matches/${m.id}/result`, { sa: Number(sa.value), sb: Number(sb.value) }); await load(); } catch (e) { toast(errText(e)); } };
    const clear = async () => { try { await api('DELETE', `/tournaments/${id}/matches/${m.id}/result`); await load(); } catch (e) { toast(errText(e)); } };
    const side = (i, input, w) => h('div', { class: 'side' + (w === true ? ' win' : w === false ? ' lose' : '') }, h('span', null, name(i)), ready ? input : m.bye ? null : played ? h('span', null, i === m.a ? m.sa : m.sb) : null);
    const decided = t.format === 'knockout' && m.winner !== null;
    return h('div', { class: 'match' + (!ready && !m.bye ? ' waiting' : ''), 'data-match': m.id, 'data-round': m.round, 'data-idx': m.idx }, side(m.a, sa, decided ? m.winner === m.a : null), side(m.b, sb, decided ? m.winner === m.b : null), m.bye ? h('div', { class: 'byebadge' }, `${t.players[m.winner]} advances (bye)`) : null,
      ready ? h('div', { class: 'actions' }, h('button', { class: 'primary', 'data-save': m.id, onclick: save }, 'Save'), played ? h('button', { 'data-clear': m.id, onclick: clear }, 'Clear') : null) : null);
  }
  function draw(t) {
    const byRound = []; for (const m of t.matches) (byRound[m.round] ||= []).push(m);
    const head = [h('h1', null, t.name), h('p', { class: 'meta', id: 'progress' }, `${t.format === 'knockout' ? 'Knockout' : 'Round robin'} · ${t.players.length} players · ${t.progress.played}/${t.progress.total} matches played`), t.champion !== null && t.champion !== undefined ? h('p', { class: 'champ', id: 'champion' }, `🏆 ${t.players[t.champion]}`) : null];
    const del = h('p', null, h('a', { href: '#/' }, '← All tournaments'), ' ', h('button', { class: 'danger', id: 'delete', onclick: async () => { if (!confirm('Delete this tournament?')) return; await api('DELETE', `/tournaments/${id}`); location.hash = '#/'; } }, 'Delete'));
    if (t.format === 'knockout') render(head, h('div', { class: 'bracket', id: 'bracket' }, byRound.map((ms, r) => h('div', { class: 'col' }, h('h3', null, roundName(r, t.rounds)), ms.map((m) => matchCard(t, m))))), del);
    else render(head, h('h2', null, 'Standings'), h('div', { class: 'scroll' }, h('table', { class: 't', id: 'standings' }, h('thead', null, h('tr', null, ['#', 'Player', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].map((x) => h('th', null, x)))), h('tbody', null, t.standings.map((s) => h('tr', { 'data-rank': s.rank }, h('td', null, s.rank), h('td', null, t.players[s.i]), [s.played, s.won, s.drawn, s.lost, s.gf, s.ga, s.gd, s.points].map((x) => h('td', null, x))))))), h('h2', null, 'Fixtures'), byRound.map((ms, r) => h('section', null, h('h3', null, `Round ${r + 1}`), h('div', { class: 'fixtures' }, ms.map((m) => matchCard(t, m))))), del);
  }
  await load();
}
let routing = Promise.resolve();
async function doRoute() {
  const parts = location.hash.slice(1).split('?')[0].split('/').filter(Boolean); document.getElementById('nav-list').removeAttribute('aria-current'); document.getElementById('nav-new').removeAttribute('aria-current');
  try {
    if (!parts.length) { document.getElementById('nav-list').setAttribute('aria-current', 'page'); await listView(); } else if (parts[0] === 'new') { document.getElementById('nav-new').setAttribute('aria-current', 'page'); newView(); }
    else if (parts[0] === 't' && parts[1]) await tourView(Number(parts[1])); else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back'));
  } catch (e) { render(h('h1', null, e.status === 404 ? 'Not found' : 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
