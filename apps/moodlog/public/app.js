const app = document.getElementById('app'), NS = 'http://www.w3.org/2000/svg';
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const sv = (tag, props, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(props || {})) e.setAttribute(k, v); add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(method, path, body) {
  const r = await fetch('/api' + path + (path.includes('?') ? '&' : '?') + 'today=' + localToday(), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; throw e; } return j;
}
const MOODS = ['Awful', 'Low', 'Okay', 'Good', 'Great'], fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const scale = (name, label, value) => h('fieldset', { id: 'fs-' + name }, h('legend', null, label), h('div', { class: 'scale' }, [1, 2, 3, 4, 5].map((n) => h('label', null, h('input', { type: 'radio', name, value: n, id: `${name}-${n}`, checked: value === n }), h('span', { title: name === 'mood' ? MOODS[n - 1] : '' }, name === 'mood' ? `${n} ${MOODS[n - 1]}` : n)))));

async function logView(sp) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('day') || '') ? sp.get('day') : localToday();
  let e = null; try { e = await api('GET', `/entries/${day}`); } catch (er) { if (er.status !== 404) throw er; }
  const date = h('input', { id: 'day', type: 'date', value: day, max: localToday(), 'aria-label': 'Date' }), sleep = h('input', { id: 'sleep', type: 'number', min: 0, max: 24, step: 0.25, value: e?.sleep ?? '', placeholder: 'e.g. 7.5' }), tags = h('input', { id: 'tags', value: (e?.tags || []).join(', '), placeholder: 'run, coffee, social' }), note = h('textarea', { id: 'note', maxlength: 500, rows: 3 }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
  note.value = e?.note || ''; date.addEventListener('change', () => { location.hash = `#/?day=${date.value}`; });
  const save = async (ev) => {
    ev.preventDefault(); err.textContent = ''; const val = (n) => { const c = app.querySelector(`input[name=${n}]:checked`); return c ? Number(c.value) : null; };
    try { await api('PUT', `/entries/${date.value}`, { mood: val('mood'), energy: val('energy'), sleep: sleep.value, tags: tags.value, note: note.value }); toast('Saved'); location.hash = '#/history'; } catch (er) { err.textContent = er.details ? Object.values(er.details).join(' · ') : er.message; }
  };
  render(h('h1', null, e ? 'Edit entry' : 'How are you today?'), h('form', { onsubmit: save }, h('label', { for: 'day' }, 'Date'), date, scale('mood', 'Mood', e?.mood), scale('energy', 'Energy', e?.energy), h('label', { for: 'sleep' }, 'Hours slept (optional)'), sleep, h('label', { for: 'tags' }, 'Tags (comma separated)'), tags, h('label', { for: 'note' }, 'Note'), note, err, h('p', null, h('button', { class: 'primary', id: 'save' }, 'Save entry'))));
}
async function historyView() {
  const rows = await api('GET', '/entries');
  render(h('h1', null, 'History'), rows.length ? rows.map((r) => h('div', { class: 'card', 'data-day': r.day }, h('strong', null, fmtDay(r.day)), h('div', { class: 'meta' }, h('span', { class: 'chip' }, `Mood ${r.mood} ${MOODS[r.mood - 1]}`), h('span', { class: 'chip' }, `Energy ${r.energy}`), r.sleep != null ? h('span', { class: 'chip' }, `${r.sleep} h sleep`) : null, r.tags.map((t) => h('span', { class: 'chip' }, '#' + t))), r.note ? h('p', null, r.note) : null,
    h('p', null, h('a', { href: `#/?day=${r.day}` }, 'Edit'), ' ', h('button', { class: 'danger', 'aria-label': `Delete ${r.day}`, onclick: async () => { if (!confirm('Delete this entry?')) return; await api('DELETE', `/entries/${r.day}`); await route(); } }, 'Delete')))) : h('p', { class: 'empty' }, 'Nothing logged yet.'));
}
function chart(r) {
  const W = 640, H = 220, L = 28, B = 22, T = 8, R = 8, n = r.series.length, x = (i) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R)), y = (v) => T + ((5 - v) / 4) * (H - T - B);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `Mood over the last ${r.days} days`, id: 'chart' });
  for (let v = 1; v <= 5; v++) svg.append(sv('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'axis' }), sv('text', { x: 4, y: y(v) + 4 }, v));
  let d = '', pen = false; r.series.forEach((p, i) => { if (p.mood == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.mood).toFixed(1)}`; pen = true; }); svg.append(sv('path', { d, class: 'mood', id: 'mood-line' }));
  r.series.forEach((p, i) => { if (p.mood != null) svg.append(sv('circle', { cx: x(i), cy: y(p.mood), r: 3, class: 'dot', 'data-day': p.day })); });
  const idx = new Map(r.series.map((p, i) => [p.day, i])); const ma = r.movingAverage.filter((p) => p.avg != null); if (ma.length > 1) svg.append(sv('path', { d: ma.map((p, i) => `${i ? 'L' : 'M'}${x(idx.get(p.day)).toFixed(1)},${y(p.avg).toFixed(1)}`).join(''), class: 'avg', id: 'avg-line' }));
  svg.append(sv('text', { x: L, y: H - 6 }, r.from), sv('text', { x: W - R, y: H - 6, 'text-anchor': 'end' }, r.to)); return svg;
}
async function insightsView(sp) {
  const days = [7, 14, 30, 90].includes(Number(sp.get('days'))) ? Number(sp.get('days')) : 30, r = await api('GET', `/insights?days=${days}`), f = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
  const sel = h('select', { id: 'range', 'aria-label': 'Range', onchange: () => { location.hash = `#/insights?days=${sel.value}`; } }, [7, 14, 30, 90].map((d) => h('option', { value: d, selected: d === days }, `Last ${d} days`)));
  const sign = (v) => (v > 0 ? '+' : '') + v.toFixed(2);
  render(h('h1', null, 'Insights'), h('div', { class: 'filters' }, sel), r.logged === 0 ? h('p', { class: 'empty', id: 'no-data' }, 'No entries in this range yet — log a few days first.') : [
    h('div', { class: 'statgrid', id: 'summary' }, [['Logged', `${r.logged}/${r.days}`], ['Avg mood', f(r.avgMood)], ['Avg energy', f(r.avgEnergy)], ['Streak', r.streak]].map(([l, v]) => h('div', { class: 'card' }, h('b', null, v), l))), chart(r),
    h('h2', null, 'What goes with a good mood?'), h('p', { id: 'corr' }, `Sleep ↔ mood: ${r.correlations.sleepMood.label}${r.correlations.sleepMood.r != null ? ` (r = ${r.correlations.sleepMood.r}, ${r.correlations.sleepMood.n} days)` : ''}. Energy ↔ mood: ${r.correlations.energyMood.label}${r.correlations.energyMood.r != null ? ` (r = ${r.correlations.energyMood.r})` : ''}.`),
    r.tagEffects.length ? h('div', { class: 'scroll' }, h('table', { class: 't', id: 'tag-effects' }, h('thead', null, h('tr', null, ['Tag', 'Days', 'Mood with', 'without', 'Difference'].map((x) => h('th', null, x)))), h('tbody', null, r.tagEffects.map((t) => h('tr', { 'data-tag': t.tag }, h('td', null, '#' + t.tag), h('td', null, t.days), h('td', null, f(t.withTag, 2)), h('td', null, f(t.without, 2)), h('td', { class: t.diff > 0 ? 'pos' : t.diff < 0 ? 'neg' : '' }, sign(t.diff))))))) : h('p', { class: 'meta' }, 'Tag a few days (at least 3 with and 3 without) to see which habits go with better days.'),
    h('p', { class: 'meta' }, 'Correlation is not causation — these are patterns in your own data, not advice.'),
    h('h2', null, 'By weekday'), h('div', { class: 'wd', id: 'weekday' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => h('div', { class: 'cell', 'data-wd': i }, h('div', { class: 'meta' }, d), h('b', null, f(r.weekday[i].avg)), h('div', { class: 'meta' }, `${r.weekday[i].n}×`))))]);
}
let routing = Promise.resolve();
async function doRoute() {
  const [path, qs] = location.hash.slice(1).split('?'), parts = path.split('/').filter(Boolean), sp = new URLSearchParams(qs || '');
  for (const id of ['log', 'history', 'insights']) document.getElementById('nav-' + id).removeAttribute('aria-current');
  try {
    if (!parts.length) { document.getElementById('nav-log').setAttribute('aria-current', 'page'); await logView(sp); }
    else if (parts[0] === 'history') { document.getElementById('nav-history').setAttribute('aria-current', 'page'); await historyView(); }
    else if (parts[0] === 'insights') { document.getElementById('nav-insights').setAttribute('aria-current', 'page'); await insightsView(sp); }
    else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back'));
  } catch (e) { render(h('h1', null, 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
