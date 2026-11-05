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
const svg = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
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
const cityOf = (z) => z.split('/').at(-1).replaceAll('_', ' ');
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const userZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };
const hm = (ms, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

const state = { zones: [], date: localToday(), start: 9, end: 17, teams: [], result: null, query: '', hits: [], errs: {} };
let timer;

function timeline(r) {
  const W = 880, L = 130, laneH = 30, H = r.zones.length * laneH + 28, x = (slot) => L + (slot / 96) * (W - L - 6);
  const s = svg('svg', { class: 'tl', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Working hours of ${r.zones.map((z) => z.city).join(', ')} over 24 hours starting at midnight in ${r.zones[0].city}` });
  for (let hr = 0; hr <= 24; hr += 2) { s.append(svg('line', { class: 'tick', x1: x(hr * 4), x2: x(hr * 4), y1: 14, y2: H - 14 })); s.append(svg('text', { x: x(hr * 4), y: 10, 'text-anchor': 'middle' }, String(hr).padStart(2, '0'))); }
  r.zones.forEach((z, i) => {
    const y = 18 + i * laneH; s.append(svg('text', { class: 'zname', x: 4, y: y + 17 }, z.city.length > 14 ? z.city.slice(0, 13) + '…' : z.city), svg('rect', { class: 'lane', x: L, y, width: W - L - 6, height: laneH - 6, rx: 4 }));
    for (const seg of z.segments) { const rc = svg('rect', { class: 'work', x: x(seg.from), y, width: x(seg.to) - x(seg.from), height: laneH - 6, rx: 3 }); rc.append(svg('title', {}, `${z.city}: ${hm(r.start + seg.from * 900000, z.zone)}–${hm(r.start + seg.to * 900000, z.zone)} (${z.offsetLabel})`)); s.append(rc); }
  });
  for (const w of r.windows) { const a = (w.start - r.start) / 900000, b = (w.end - r.start) / 900000; s.append(svg('rect', { class: 'all', x: x(a), y: 16, width: x(b) - x(a), height: H - 30 }), svg('rect', { class: 'win', x: x(a), y: 16, width: x(b) - x(a), height: H - 30, rx: 4 })); }
  s.append(svg('text', { x: L, y: H - 2 }, `Hours are local time in ${r.zones[0].city} (${r.zones[0].offsetLabel})`));
  return s;
}
const dur = (min) => `${Math.floor(min / 60)}h${min % 60 ? ' ' + (min % 60) + 'm' : ''}`;

function draw() {
  const r = state.result, e = state.errs;
  const chips = h('ul', { class: 'chips', id: 'zones', 'aria-label': 'Selected time zones', style: null }, state.zones.map((z, i) => h('li', { class: 'chip', 'data-zone': z }, h('span', {}, cityOf(z), i === 0 ? h('span', { class: 'small muted' }, ' (anchor)') : null), h('button', { 'aria-label': 'Remove ' + cityOf(z), onclick: () => { state.zones.splice(i, 1); compute(); } }, '×'))));
  const search = h('input', { type: 'search', id: 'zone-search', 'aria-label': 'Search time zones', placeholder: 'Add a city or region, e.g. Seoul', autocomplete: 'off', value: state.query, oninput: (ev) => { state.query = ev.target.value; clearTimeout(timer); timer = setTimeout(searchZones, 150); } });
  const hours = (name, v, id) => h('select', { id, 'aria-label': name, onchange: (ev) => { state[id === 'start' ? 'start' : 'end'] = Number(ev.target.value); compute(); } }, Array.from({ length: id === 'start' ? 24 : 24 }, (_, k) => (id === 'start' ? k : k + 1)).map((k) => h('option', { value: k, selected: k === v }, String(k).padStart(2, '0') + ':00')));
  const teamBox = h('div', { class: 'card' }, h('h2', {}, 'Saved teams'), state.teams.length ? h('div', { class: 'chips' }, state.teams.map((t) => h('span', { class: 'chip', 'data-team': t.name }, h('button', { style: null, class: 'load', 'aria-label': 'Load team ' + t.name, onclick: () => { state.zones = [...t.zones]; state.start = t.start; state.end = t.end; compute(); toast(`Loaded ${t.name}`); } }, t.name), h('button', { 'aria-label': 'Delete team ' + t.name, onclick: async () => { try { await api('/teams/' + t.id, { method: 'DELETE' }); state.teams = state.teams.filter((x) => x.id !== t.id); draw(); toast('Team deleted'); } catch (x) { toast(x.message, 'error'); } } }, '×')))) : h('p', { class: 'muted small' }, 'Save the current zones and hours as a team to reuse them later.'),
    h('form', { class: 'row', novalidate: true, onsubmit: async (ev) => { ev.preventDefault(); const name = new FormData(ev.target).get('name'); try { const t = await api('/teams', { method: 'POST', body: { name, zones: state.zones, start: state.start, end: state.end } }); state.teams.push(t); state.teams.sort((a, b) => a.name.localeCompare(b.name)); draw(); toast('Team saved'); } catch (x) { $('#team-err').textContent = x.details ? Object.values(x.details).join(' · ') : x.message; } } },
      h('input', { type: 'text', name: 'name', id: 'team-name', 'aria-label': 'Team name', placeholder: 'Team name', maxlength: 60, style: null }), h('button', { class: 'btn', id: 'save-team' }, 'Save team'), h('span', { class: 'err', id: 'team-err', role: 'alert' })));
  const winList = r && r.best ? r.windows.map((w, i) => h('div', { class: 'win', 'data-win': i }, h('div', { class: w === r.best ? 'best' : '' }, `${dur(w.minutes)}${w === r.best ? ' · longest' : ''}`),
    h('table', {}, h('tbody', {}, w.local.map((l) => h('tr', {}, h('td', {}, cityOf(l.zone)), h('td', {}, h('strong', {}, `${l.start} – ${l.end}`)), h('td', { class: 'small muted' }, l.day))))))) : null;
  const nowTable = r ? h('table', { class: 'small', 'aria-label': 'Current local times' }, h('tbody', {}, r.zones.map((z) => h('tr', {}, h('td', {}, h('strong', {}, z.city)), h('td', { class: 'muted' }, z.offsetLabel), h('td', {}, `now ${z.nowLocal}`))))) : null;
  const resultCard = r
    ? h('div', { class: 'card', id: 'result' }, h('h2', {}, r.best ? `Best window: ${dur(r.best.minutes)}` : 'No common working hours'), timeline(r),
      r.best ? winList : h('p', { class: 'muted' }, 'These zones never share working hours on this date. Try widening the working hours, or pick fewer zones.'), nowTable)
    : h('div', { class: 'card empty' }, 'Add at least two time zones to see when everyone is available.');
  main.replaceChildren(
    h('div', { class: 'card' }, h('h1', {}, 'Where is everyone?'), chips, e.zones ? h('div', { class: 'err', id: 'zones-err', role: 'alert' }, e.zones) : null, search, h('ul', { class: 'results', id: 'zone-results', hidden: !state.hits.length }, state.hits.map((z) => h('li', {}, h('button', { 'data-add': z.zone, onclick: () => { if (!state.zones.includes(z.zone)) state.zones.push(z.zone); state.query = ''; state.hits = []; compute(); } }, h('span', {}, `${z.city}`, z.region ? h('span', { class: 'small muted' }, ` · ${z.region}`) : null), h('span', { class: 'small muted' }, z.offsetLabel))))),
      h('div', { class: 'cols' }, h('label', { class: 'f' }, 'Date (in the first zone)', h('input', { type: 'date', id: 'date', value: state.date, onchange: (ev) => { state.date = ev.target.value; compute(); } })), h('label', { class: 'f' }, 'Working day starts', hours('Working day starts', state.start, 'start')), h('label', { class: 'f' }, 'Working day ends', hours('Working day ends', state.end, 'end'))), e.hours ? h('div', { class: 'err', role: 'alert', id: 'hours-err' }, e.hours) : null, e.date ? h('div', { class: 'err', role: 'alert' }, e.date) : null),
    resultCard,
    teamBox);
  if (document.activeElement === document.body && state.query) $('#zone-search')?.focus();
}
async function searchZones() { try { state.hits = state.query.trim() ? await api('/zones?q=' + encodeURIComponent(state.query)) : []; const keep = $('#zone-search')?.selectionStart; draw(); const s = $('#zone-search'); s?.focus(); if (keep != null) s?.setSelectionRange(keep, keep); } catch (x) { toast(x.message, 'error'); } }
let seq = 0;
async function compute() {
  state.errs = {}; const my = ++seq;
  if (state.zones.length < 2) { state.result = null; draw(); return; }
  try { const r = await api('/overlap', { method: 'POST', body: { zones: state.zones, date: state.date, start: state.start, end: state.end } }); if (my !== seq) return; state.result = r; }
  catch (x) { if (my !== seq) return; state.result = null; state.errs = x.details || { zones: x.message }; }
  draw();
}
async function init() {
  try { state.teams = await api('/teams'); } catch (x) { main.replaceChildren(h('div', { class: 'banner', role: 'alert' }, x.message, ' ', h('button', { class: 'btn', onclick: init }, 'Retry'))); return; }
  const mine = userZone(); state.zones = ['UTC', mine].filter((z, i, a) => a.indexOf(z) === i); if (state.zones.length < 2) state.zones = ['America/New_York', 'Europe/London'];
  await compute();
}
init();
