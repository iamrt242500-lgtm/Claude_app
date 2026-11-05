import { addDays, weekStart, hours } from '/roster.js';
const app = document.getElementById('app'), SVG = 'http://www.w3.org/2000/svg';
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; e.problems = j?.problems; throw e; } return j;
}
const errText = (e) => (e.details ? Object.values(e.details).join(' · ') : e.message), WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], wdNum = [1, 2, 3, 4, 5, 6, 0];
const short = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

async function weekView(sp) {
  const week = weekStart(sp.get('week') || localToday()), [w, people] = await Promise.all([api('GET', `/schedule?week=${week}`), api('GET', '/people')]), byId = new Map(people.map((p) => [p.id, p])), days = [...Array(7)].map((_, i) => addDays(week, i));
  const cell = (pid, day) => h('td', { 'data-cell': `${pid ?? 'open'}:${day}` }, w.shifts.filter((s) => s.personId === pid && s.day === day).map((s) => h('a', { class: 'btn shift' + (s.problems.length ? ' warn' : '') + (pid === null ? ' open' : ''), href: `#/shift/${s.id}`, 'data-shift': s.id, title: s.problems.map((p) => p.message).join('\n') }, `${s.start}–${s.end}`, s.problems.length ? ' ⚠' : '', s.note ? h('div', { class: 'meta' }, s.note) : null)), h('a', { class: 'addbtn btn', href: `#/shift/new?day=${day}${pid ? `&person=${pid}` : ''}`, 'aria-label': `Add shift ${pid ? byId.get(pid).name : 'open'} ${day}` }, '+'));
  const covRow = (day) => { const c = w.coverage[day], max = Math.max(1, ...c), svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 24 20'); svg.setAttribute('class', 'cov'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Coverage ${day}: peak ${Math.max(...c)}`); c.forEach((n, i) => { const r = document.createElementNS(SVG, 'rect'); r.setAttribute('x', i); r.setAttribute('width', 0.8); r.setAttribute('y', 20 - (n / max) * 20); r.setAttribute('height', (n / max) * 20); r.setAttribute('fill', 'currentColor'); svg.append(r); }); return svg; };
  render(h('h1', null, 'Weekly schedule'), h('div', { class: 'weekbar' }, h('a', { class: 'btn', id: 'prev', href: `#/?week=${addDays(week, -7)}` }, '← Prev'), h('strong', { id: 'range' }, `${short(week)} – ${short(addDays(week, 6))}`), h('a', { class: 'btn', id: 'next', href: `#/?week=${addDays(week, 7)}` }, 'Next →'), h('a', { class: 'btn', href: '#/' }, 'This week'), h('a', { class: 'btn primary', href: `#/shift/new?day=${week}` }, 'Add shift')),
    h('div', { class: 'sum', id: 'summary' }, h('span', { class: 'chip' }, `${w.shifts.length} shifts`), h('span', { class: 'chip' }, `${w.open} open`), h('span', { class: 'chip' + (w.problems ? ' overdue' : '') }, `${w.problems} problem${w.problems === 1 ? '' : 's'}`)),
    h('div', { class: 'scroll' }, h('table', { class: 'grid', id: 'grid' }, h('thead', null, h('tr', null, h('th', { class: 'p' }, ''), days.map((d, i) => h('th', null, `${WD[i]} ${short(d).split(' ')[1]}`)))), h('tbody', null,
      people.map((p) => h('tr', { 'data-person': p.id }, h('th', { class: 'p' }, p.name, h('div', { class: 'meta' }, `${(w.hoursByPerson[p.id] || 0)} h`)), days.map((d) => cell(p.id, d)))),
      h('tr', { 'data-person': 'open' }, h('th', { class: 'p' }, 'Open shifts'), days.map((d) => cell(null, d))),
      h('tr', null, h('th', { class: 'p' }, 'Coverage'), days.map((d) => h('td', null, covRow(d))))))), people.length ? null : h('p', { class: 'empty' }, 'Add people first, then schedule shifts.'));
}

async function shiftView(id, sp) {
  const people = await api('GET', '/people'), s = id === 'new' ? { day: sp.get('day') || localToday(), start: '09:00', end: '17:00', personId: sp.get('person') ? Number(sp.get('person')) : null, note: '' } : await api('GET', `/shifts/${id}`);
  const person = h('select', { id: 'person' }, h('option', { value: '' }, 'Open (unassigned)'), people.map((p) => h('option', { value: p.id, selected: p.id === s.personId }, p.name))), day = h('input', { id: 'day', type: 'date', value: s.day }), start = h('input', { id: 'start', type: 'time', value: s.start }), end = h('input', { id: 'end', type: 'time', value: s.end }), note = h('input', { id: 'note', maxlength: 100, value: s.note }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' }), probs = h('div', { id: 'problems' }), dur = h('span', { class: 'meta', id: 'dur' });
  const upd = () => { if (!start.value || !end.value) { dur.textContent = ''; return; } const hrs = hours({ day: day.value, start: start.value, end: end.value }); dur.textContent = hrs ? `${hrs} h${start.value >= end.value ? ' (overnight)' : ''}` : 'invalid length'; }; for (const el of [day, start, end]) el.addEventListener('input', upd); upd();
  const send = async (force) => {
    err.textContent = ''; probs.replaceChildren(); const body = { personId: person.value ? Number(person.value) : null, day: day.value, start: start.value, end: end.value, note: note.value, force }; try { await api(id === 'new' ? 'POST' : 'PUT', id === 'new' ? '/shifts' : `/shifts/${id}`, body); toast(force ? 'Saved with warnings' : 'Saved'); location.hash = `#/?week=${weekStart(day.value)}`; }
    catch (e) { if (e.status === 409 && e.problems) add(probs, [h('div', { class: 'probs' }, h('strong', null, 'This assignment has problems:'), h('ul', null, e.problems.map((p) => h('li', { 'data-code': p.code }, p.message))), h('button', { type: 'button', class: 'danger', id: 'force', onclick: () => send(true) }, 'Assign anyway'))]); else err.textContent = errText(e); }
  };
  render(h('h1', null, id === 'new' ? 'New shift' : 'Edit shift'), h('form', { onsubmit: (ev) => { ev.preventDefault(); send(false); } }, h('label', { for: 'person' }, 'Person'), person, h('label', { for: 'day' }, 'Date'), day, h('label', { for: 'start' }, 'Start'), start, h('label', { for: 'end' }, 'End (earlier than start = next day)'), end, dur, h('label', { for: 'note' }, 'Note'), note, err, probs, h('p', null, h('button', { class: 'primary', id: 'save' }, 'Save shift'), ' ', id !== 'new' ? h('button', { type: 'button', class: 'danger', id: 'delete', onclick: async () => { if (!confirm('Delete this shift?')) return; await api('DELETE', `/shifts/${id}`); location.hash = `#/?week=${weekStart(s.day)}`; } }, 'Delete') : null)));
}

async function peopleView() {
  const [people, off, rules] = await Promise.all([api('GET', '/people'), api('GET', '/timeoff'), api('GET', '/settings')]);
  const name = h('input', { id: 'pname', maxlength: 40 }), role = h('input', { id: 'prole', maxlength: 30 }), un = WD.map((d, i) => h('label', null, h('input', { type: 'checkbox', value: wdNum[i], 'data-wd': d }), d)), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
  const addP = async (ev) => { ev.preventDefault(); err.textContent = ''; try { await api('POST', '/people', { name: name.value, role: role.value, unavailable: un.map((l) => l.firstChild).filter((c) => c.checked).map((c) => Number(c.value)) }); await route(); } catch (e) { err.textContent = errText(e); } };
  const mw = h('input', { id: 'maxw', type: 'number', min: 1, max: 168, value: rules.maxWeeklyHours }), mr = h('input', { id: 'minr', type: 'number', min: 0, max: 24, step: 0.5, value: rules.minRestHours }), serr = h('p', { class: 'err', id: 'settings-error' });
  const saveS = async (ev) => { ev.preventDefault(); serr.textContent = ''; try { await api('PUT', '/settings', { maxWeeklyHours: Number(mw.value), minRestHours: Number(mr.value) }); toast('Rules saved'); } catch (e) { serr.textContent = errText(e); } };
  const offP = h('select', { id: 'off-person', 'aria-label': 'Person' }, people.map((p) => h('option', { value: p.id }, p.name))), offD = h('input', { id: 'off-day', type: 'date', 'aria-label': 'Day off' });
  render(h('h1', null, 'People'), h('form', { class: 'card', onsubmit: addP }, h('div', { class: 'row' }, h('div', null, h('label', { for: 'pname' }, 'Name'), name), h('div', null, h('label', { for: 'prole' }, 'Role'), role)), h('label', null, 'Never available on'), h('div', { class: 'days' }, un), err, h('p', null, h('button', { class: 'primary' }, 'Add person'))),
    people.map((p) => h('div', { class: 'card', 'data-p': p.id }, h('strong', null, p.name), ' ', p.role ? h('span', { class: 'chip' }, p.role) : null, p.unavailable.length ? h('span', { class: 'meta' }, ` unavailable: ${p.unavailable.map((d) => WD[wdNum.indexOf(d)]).join(', ')}`) : null, ' ', h('button', { class: 'danger', 'aria-label': `Remove ${p.name}`, onclick: async () => { if (!confirm(`Remove ${p.name}? Their shifts become open shifts.`)) return; await api('DELETE', `/people/${p.id}`); await route(); } }, 'Remove'), off.filter((o) => o.personId === p.id).map((o) => h('div', { class: 'meta', 'data-off': o.id }, `Off ${o.day} `, h('button', { 'aria-label': `Cancel time off ${o.day}`, onclick: async () => { await api('DELETE', `/timeoff/${o.id}`); await route(); } }, '×'))))),
    people.length ? h('form', { class: 'card row', onsubmit: async (ev) => { ev.preventDefault(); try { await api('POST', '/timeoff', { personId: Number(offP.value), day: offD.value }); await route(); } catch (e) { toast(errText(e)); } } }, h('strong', null, 'Time off'), offP, offD, h('button', null, 'Add')) : null,
    h('h2', null, 'Scheduling rules'), h('form', { class: 'card', onsubmit: saveS }, h('div', { class: 'row' }, h('div', null, h('label', { for: 'maxw' }, 'Max hours per week'), mw), h('div', null, h('label', { for: 'minr' }, 'Min rest between shifts (h)'), mr)), serr, h('p', null, h('button', { id: 'save-rules' }, 'Save rules'))));
}
let routing = Promise.resolve();
async function doRoute() {
  const [path, qs] = location.hash.slice(1).split('?'), parts = path.split('/').filter(Boolean), sp = new URLSearchParams(qs || '');
  document.getElementById('nav-week').removeAttribute('aria-current'); document.getElementById('nav-people').removeAttribute('aria-current');
  try {
    if (!parts.length) { document.getElementById('nav-week').setAttribute('aria-current', 'page'); await weekView(sp); }
    else if (parts[0] === 'shift' && parts[1]) await shiftView(parts[1], sp); else if (parts[0] === 'people') { document.getElementById('nav-people').setAttribute('aria-current', 'page'); await peopleView(); }
    else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back'));
  } catch (e) { render(h('h1', null, e.status === 404 ? 'Not found' : 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
