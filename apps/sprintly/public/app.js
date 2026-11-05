const app = document.getElementById('app'), NS = 'http://www.w3.org/2000/svg';
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const sv = (tag, props, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(props || {})) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(method, path, body) {
  const r = await fetch('/api' + path + (path.includes('?') ? '&' : '?') + 'today=' + localToday(), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; throw e; } return j;
}
const errText = (e) => (e.details ? Object.values(e.details).join(' · ') : e.message), fmt = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

async function listView() {
  const list = await api('GET', '/sprints'), name = h('input', { id: 'name', maxlength: 60 }), start = h('input', { id: 'start', type: 'date', value: localToday() }), end = h('input', { id: 'end', type: 'date' }), goal = h('input', { id: 'goal', maxlength: 200, size: 30 }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
  render(h('h1', null, 'Sprints'), h('form', { class: 'card row', onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; try { const s = await api('POST', '/sprints', { name: name.value, start: start.value, end: end.value, goal: goal.value }); location.hash = `#/s/${s.id}`; } catch (e) { err.textContent = errText(e); } } }, h('div', null, h('label', { for: 'name' }, 'Name'), name), h('div', null, h('label', { for: 'start' }, 'Start'), start), h('div', null, h('label', { for: 'end' }, 'End'), end), h('div', null, h('label', { for: 'goal' }, 'Goal'), goal), h('button', { class: 'primary' }, 'Create sprint'), err),
    list.length ? list.map((s) => h('a', { class: 'card', href: `#/s/${s.id}`, 'data-sprint': s.name }, h('strong', null, s.name), ' ', h('span', { class: 'chip ' + s.status.replace(' ', '-') }, s.status), h('div', { class: 'meta' }, `${s.start} → ${s.end} · ${s.remaining} of ${s.scope} pts left · ${s.tasks} tasks`))) : h('p', { class: 'empty' }, 'No sprints yet.'));
}
function burndown(d) {
  const W = 640, H = 240, L = 34, R = 10, T = 10, B = 26, n = d.chart.length, max = Math.max(1, d.startPoint, ...d.chart.map((c) => c.remaining ?? 0)), x = (i) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R)), y = (v) => T + (1 - v / max) * (H - T - B);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `Burndown: ${d.forecast.remaining} points remaining`, id: 'burndown' });
  for (let i = 0; i <= 4; i++) { const v = Math.round((max * i) / 4); svg.append(sv('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'axis' }), sv('text', { x: 2, y: y(v) + 3 }, v)); }
  svg.append(sv('path', { d: [`M${x(0)},${y(d.startPoint)}`, ...d.chart.map((c, i) => `L${x(i)},${y(c.ideal)}`)].join(''), class: 'ideal', id: 'ideal-line' }));
  const pts = d.chart.map((c, i) => [c, i]).filter(([c]) => c.remaining !== null); if (pts.length) svg.append(sv('path', { d: pts.map(([c, i], k) => `${k ? 'L' : 'M'}${x(i)},${y(c.remaining)}`).join(''), class: 'actual', id: 'actual-line' }));
  for (const [c, i] of pts) svg.append(sv('circle', { cx: x(i), cy: y(c.remaining), r: 3.5, class: 'pt', 'data-day': c.day, 'data-remaining': c.remaining }));
  svg.append(sv('text', { x: L, y: H - 8 }, d.chart[0]?.day.slice(5) ?? ''), sv('text', { x: W - R, y: H - 8, 'text-anchor': 'end' }, d.chart.at(-1)?.day.slice(5) ?? '')); return svg;
}
async function sprintView(id) {
  const load = async () => draw(await api('GET', `/sprints/${id}`));
  function draw(d) {
    const f = d.forecast, title = h('input', { id: 'ttitle', maxlength: 120, 'aria-label': 'Task title', placeholder: 'New task' }), pts = h('input', { id: 'tpts', type: 'number', min: 1, max: 100, value: 3, 'aria-label': 'Points', size: 3 }), err = h('p', { class: 'err', id: 'task-error', role: 'alert' });
    const row = (t) => h('div', { class: 'card t' + (t.doneDay ? ' done' : ''), 'data-task': t.title }, h('input', { type: 'checkbox', checked: !!t.doneDay, 'aria-label': `Done: ${t.title}`, onchange: async (ev) => { try { await api('PATCH', `/tasks/${t.id}`, { done: ev.target.checked }); await load(); } catch (e) { toast(errText(e)); } } }), h('span', { class: 'title' }, t.title), t.addedDay > d.start ? h('span', { class: 'chip' }, 'added mid-sprint') : null, h('span', { class: 'chip' }, `${t.points} pt`), h('button', { class: 'danger', 'aria-label': `Delete ${t.title}`, onclick: async () => { await api('DELETE', `/tasks/${t.id}`); await load(); } }, '✕'));
    const msg = f.status === 'complete' ? 'All work is done.' : f.finish ? `At ${f.velocity} pts/day the remaining ${f.remaining} pts finish on ${fmt(f.finish)}${f.finishesInSprint ? ' — inside the sprint.' : ' — after the sprint ends.'}` : f.status === 'not started' ? 'The sprint hasn’t started.' : f.remaining ? 'Nothing finished yet, so no forecast.' : 'Add tasks to begin.';
    render(h('h1', null, d.name), h('p', { class: 'meta' }, `${fmt(d.start)} → ${fmt(d.end)} · ${f.totalWorkdays} working days${d.goal ? ` · Goal: ${d.goal}` : ''}`),
      h('div', { class: 'statgrid', id: 'stats' }, [['Remaining', f.remaining], ['Done', f.done], ['Velocity', f.velocity], ['Scope', f.scope + (d.addedAfterStart ? ` +${d.addedAfterStart}` : '')]].map(([l, v]) => h('div', { class: 'card' }, h('b', null, v), l))),
      h('p', null, h('span', { class: 'chip ' + f.status.replace(' ', '-'), id: 'status' }, f.status), ' ', h('span', { id: 'forecast' }, msg)), burndown(d),
      h('form', { class: 'card row', onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; try { await api('POST', `/sprints/${id}/tasks`, { title: title.value, points: Number(pts.value) }); await load(); } catch (e) { err.textContent = errText(e); } } }, h('div', null, h('label', { for: 'ttitle' }, 'Task'), title), h('div', null, h('label', { for: 'tpts' }, 'Points'), pts), h('button', { class: 'primary', id: 'add-task' }, 'Add task'), err),
      h('div', { class: 'board' }, h('section', { id: 'todo' }, h('h2', null, 'To do'), d.tasks.filter((t) => !t.doneDay).map(row)), h('section', { id: 'done' }, h('h2', null, 'Done'), d.tasks.filter((t) => t.doneDay).map(row))),
      h('p', null, h('a', { href: '#/' }, '← Sprints'), ' ', h('button', { class: 'danger', id: 'delete', onclick: async () => { if (!confirm('Delete this sprint?')) return; await api('DELETE', `/sprints/${id}`); location.hash = '#/'; } }, 'Delete sprint')));
  }
  await load();
}
let routing = Promise.resolve();
async function doRoute() {
  const parts = location.hash.slice(1).split('?')[0].split('/').filter(Boolean); document.getElementById('nav-sprints').removeAttribute('aria-current');
  try { if (!parts.length) { document.getElementById('nav-sprints').setAttribute('aria-current', 'page'); await listView(); } else if (parts[0] === 's' && parts[1]) await sprintView(Number(parts[1])); else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back')); }
  catch (e) { render(h('h1', null, e.status === 404 ? 'Not found' : 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
