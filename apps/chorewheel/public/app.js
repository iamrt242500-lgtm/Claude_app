const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(method, path, body) {
  const r = await fetch('/api' + path + (path.includes('?') ? '&' : '?') + 'today=' + localToday(), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; throw e; } return j;
}
const errText = (e) => (e.details ? Object.values(e.details).join(' · ') : e.message), fmt = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

async function boardView() {
  const [b, people] = await Promise.all([api('GET', '/board'), api('GET', '/members')]);
  const row = (a) => {
    const cb = h('input', { type: 'checkbox', checked: !!a.doneDay, 'aria-label': `Mark ${a.chore} done`, onchange: async () => { try { await api('PATCH', `/assignments/${a.id}`, { done: cb.checked }); await route(); } catch (e) { toast(errText(e)); cb.checked = !cb.checked; } } });
    const sel = h('select', { 'aria-label': `Assignee for ${a.chore}`, disabled: !!a.doneDay, onchange: async () => { try { await api('PATCH', `/assignments/${a.id}`, { memberId: sel.value ? Number(sel.value) : null }); await route(); } catch (e) { toast(errText(e)); } } }, h('option', { value: '' }, 'Nobody'), people.map((m) => h('option', { value: m.id, selected: m.id === a.memberId }, m.name)));
    return h('div', { class: 'card ass' + (a.doneDay ? ' done' : ''), 'data-a': a.id, 'data-chore': a.chore }, cb, h('span', { class: 'name' }, a.chore, ' ', h('span', { class: 'chip' }, `${a.points} pt`), a.dueDay < b.today && !a.doneDay ? h('span', { class: 'chip overdue' }, `due ${fmt(a.dueDay)}`) : null), sel);
  };
  const section = (title, id, list) => h('section', { id }, h('h2', null, `${title} (${list.length})`), list.length ? list.map(row) : h('p', { class: 'empty' }, 'Nothing here.'));
  const days = [...new Set(b.upcoming.map((a) => a.dueDay))], maxP = Math.max(1, ...b.members.map((m) => m.assignedPoints));
  render(h('h1', null, 'Chore board'), h('div', { class: 'people', id: 'people' }, b.members.map((m) => h('div', { class: 'card', 'data-member': m.name }, h('strong', null, m.name), m.away ? h('span', { class: 'away' }, ` away until ${fmt(m.awayUntil)}`) : null, h('div', { class: 'meta' }, `${m.donePoints} done / ${m.assignedPoints} assigned pts`), h('div', { class: 'bar' }, h('i', { 'data-w': Math.round((m.assignedPoints / maxP) * 100) }))))),
    h('p', { class: 'meta', id: 'fairness' }, b.members.length ? `Last ${b.windowDays} days: spread ${b.fairness.spread} pts · shares ${b.members.map((m) => `${m.name} ${b.fairness.shares[m.id] ?? 0}%`).join(', ')}` : 'Add people and chores under Manage.'),
    b.overdue.length ? section('Overdue', 'overdue', b.overdue) : null, section('Today', 'today', b.dueToday), h('h2', null, 'Coming up'), days.length ? days.map((d) => h('section', { 'data-day': d }, h('h3', null, fmt(d)), b.upcoming.filter((a) => a.dueDay === d).map(row))) : h('p', { class: 'empty' }, 'Nothing scheduled this week.'));
  document.querySelectorAll('.bar i').forEach((el) => { el.style.width = el.dataset.w + '%'; });
}
async function manageView() {
  const [members, chores] = await Promise.all([api('GET', '/members'), api('GET', '/chores')]);
  const mname = h('input', { id: 'mname', maxlength: 30 }), merr = h('p', { class: 'err', id: 'member-error', role: 'alert' });
  const cname = h('input', { id: 'cname', maxlength: 60 }), cpts = h('input', { id: 'cpts', type: 'number', min: 1, max: 10, value: 2, size: 3 }), cev = h('input', { id: 'cevery', type: 'number', min: 1, max: 365, value: 7, size: 4 }), cstart = h('input', { id: 'cstart', type: 'date', value: localToday() }), cerr = h('p', { class: 'err', id: 'chore-error', role: 'alert' });
  render(h('h1', null, 'People'), h('form', { class: 'card row', onsubmit: async (ev) => { ev.preventDefault(); merr.textContent = ''; try { await api('POST', '/members', { name: mname.value }); await route(); } catch (e) { merr.textContent = errText(e); } } }, h('div', null, h('label', { for: 'mname' }, 'Name'), mname), h('button', { class: 'primary' }, 'Add person'), merr),
    members.map((m) => { const away = h('input', { type: 'date', value: m.awayUntil || '', 'aria-label': `Away until for ${m.name}` }); return h('div', { class: 'card row', 'data-m': m.name }, h('strong', null, m.name), h('label', null, 'Away until'), away, h('button', { 'aria-label': `Save away date for ${m.name}`, onclick: async () => { try { await api('PATCH', `/members/${m.id}`, { awayUntil: away.value || null }); toast('Saved'); } catch (e) { toast(errText(e)); } } }, 'Save'), h('button', { class: 'danger', 'aria-label': `Remove ${m.name}`, onclick: async () => { if (!confirm(`Remove ${m.name}? Their open chores go to others.`)) return; await api('DELETE', `/members/${m.id}`); await route(); } }, 'Remove')); }),
    h('h1', null, 'Chores'), h('form', { class: 'card row', onsubmit: async (ev) => { ev.preventDefault(); cerr.textContent = ''; try { await api('POST', '/chores', { name: cname.value, points: Number(cpts.value), every: Number(cev.value), start: cstart.value }); await route(); } catch (e) { cerr.textContent = errText(e); } } }, h('div', null, h('label', { for: 'cname' }, 'Chore'), cname), h('div', null, h('label', { for: 'cpts' }, 'Points'), cpts), h('div', null, h('label', { for: 'cevery' }, 'Every (days)'), cev), h('div', null, h('label', { for: 'cstart' }, 'Starts'), cstart), h('button', { class: 'primary' }, 'Add chore'), cerr),
    chores.map((c) => h('div', { class: 'card row', 'data-c': c.name }, h('strong', null, c.name), h('span', { class: 'meta' }, `${c.points} pt · every ${c.every} d · from ${c.start}${c.archived ? ' · archived' : ''}`), h('button', { 'aria-label': `${c.archived ? 'Restore' : 'Archive'} ${c.name}`, onclick: async () => { await api('PATCH', `/chores/${c.id}`, { archived: !c.archived }); await route(); } }, c.archived ? 'Restore' : 'Archive'), h('button', { class: 'danger', 'aria-label': `Delete ${c.name}`, onclick: async () => { if (!confirm(`Delete ${c.name} and its history?`)) return; await api('DELETE', `/chores/${c.id}`); await route(); } }, 'Delete'))));
}
let routing = Promise.resolve();
async function doRoute() {
  const parts = location.hash.slice(1).split('?')[0].split('/').filter(Boolean); document.getElementById('nav-board').removeAttribute('aria-current'); document.getElementById('nav-manage').removeAttribute('aria-current');
  try { if (!parts.length) { document.getElementById('nav-board').setAttribute('aria-current', 'page'); await boardView(); } else if (parts[0] === 'manage') { document.getElementById('nav-manage').setAttribute('aria-current', 'page'); await manageView(); } else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back')); }
  catch (e) { render(h('h1', null, 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
