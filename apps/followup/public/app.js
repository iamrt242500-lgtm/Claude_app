import { extractTasks, bucket } from '/extract.js';
const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.details = j?.details; throw e; } return j;
}
const BUCKETS = [['overdue', 'Overdue'], ['today', 'Today'], ['week', 'This week'], ['later', 'Later'], ['none', 'No date'], ['done', 'Done']];
const fmt = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); };

function taskRow(t, reload) {
  const cb = h('input', { type: 'checkbox', 'aria-label': `Mark "${t.text}" done`, checked: t.done, onchange: async () => { try { await api('PATCH', `/tasks/${t.id}`, { done: cb.checked }); await reload(); } catch (e) { toast(e.message); cb.checked = !cb.checked; } } });
  return h('div', { class: 'card task' + (t.done ? ' done' : ''), 'data-task': t.id }, cb,
    h('div', { class: 'body' }, h('div', { class: 'txt' }, t.text), h('div', { class: 'meta' },
      t.owner ? h('span', { class: 'chip' }, '@' + t.owner) : h('span', { class: 'chip' }, 'unassigned'),
      t.due ? h('span', { class: 'chip ' + (t.done ? '' : t.bucket) }, fmt(t.due)) : null,
      t.meetingId ? h('a', { href: `#/meetings/${t.meetingId}` }, t.meetingTitle) : h('span', null, 'manual'))),
    h('button', { 'aria-label': `Delete "${t.text}"`, class: 'danger', onclick: async () => { if (!confirm('Delete this task?')) return; await api('DELETE', `/tasks/${t.id}`); await reload(); } }, '✕'));
}

async function tasksView(sp) {
  const owner = sp.get('owner') || '', status = sp.get('status') || 'open';
  const q = new URLSearchParams({ today: localToday(), status }); if (owner) q.set('owner', owner);
  const load = async () => { const d = await api('GET', '/tasks?' + q); draw(d); };
  const draw = (d) => {
    const go = (o, s) => { const p = new URLSearchParams(); if (o) p.set('owner', o); if (s !== 'open') p.set('status', s); location.hash = '#/' + (p.size ? '?' + p : ''); };
    const ownerSel = h('select', { id: 'owner-filter', 'aria-label': 'Filter by owner', onchange: () => go(ownerSel.value, status) }, h('option', { value: '' }, 'Everyone'), d.owners.map((o) => h('option', { value: o, selected: o.toLowerCase() === owner.toLowerCase() }, o)));
    const statusSel = h('select', { id: 'status-filter', 'aria-label': 'Filter by status', onchange: () => go(owner, statusSel.value) }, ['open', 'done', 'all'].map((s) => h('option', { value: s, selected: s === status }, s[0].toUpperCase() + s.slice(1))));
    const addInput = h('input', { id: 'quick-text', placeholder: 'Quick add a task…', maxlength: 300, 'aria-label': 'New task' });
    const addForm = h('form', { class: 'filters', onsubmit: async (e) => { e.preventDefault(); if (!addInput.value.trim()) return; const [t] = extractTasks('TODO: ' + addInput.value, localToday()); try { await api('POST', '/tasks', { text: t?.text || addInput.value.trim(), owner: t?.owner, due: t?.due }); addInput.value = ''; await load(); } catch (er) { toast(er.details ? Object.values(er.details)[0] : er.message); } } }, addInput, h('button', { class: 'primary' }, 'Add'));
    const groups = BUCKETS.map(([k, label]) => [k, label, d.tasks.filter((t) => t.bucket === k)]).filter(([, , l]) => l.length);
    render(h('h1', null, 'Tasks'), h('p', { class: 'meta', id: 'summary' }, `${d.counts.open} open · ${d.counts.overdue} overdue · ${d.counts.today} due today`), h('div', { class: 'filters' }, ownerSel, statusSel), addForm,
      groups.length ? groups.map(([k, label, list]) => h('section', { 'data-bucket': k }, h('h2', null, `${label} (${list.length})`), list.map((t) => taskRow(t, load)))) : h('p', { class: 'empty' }, 'No tasks here. Paste meeting notes under “New meeting” to extract some.'));
  };
  await load();
}

async function meetingsView() {
  const list = await api('GET', '/meetings');
  render(h('h1', null, 'Meetings'), list.length ? list.map((m) => h('a', { class: 'card', href: `#/meetings/${m.id}`, 'data-meeting': m.id }, h('strong', null, m.title), h('div', { class: 'meta' }, h('span', null, m.day), h('span', null, `${m.open} open of ${m.tasks} tasks`)))) : h('p', { class: 'empty' }, 'No meetings yet.'), h('a', { class: 'btn primary', href: '#/new' }, 'New meeting'));
}

async function editorView(id) {
  const m = id ? await api('GET', `/meetings/${id}?today=${localToday()}`) : { title: '', day: localToday(), notes: '' };
  const title = h('input', { id: 'title', value: m.title, maxlength: 120, required: true }), day = h('input', { id: 'day', type: 'date', value: m.day }), notes = h('textarea', { id: 'notes', placeholder: 'Paste meeting notes. Try: "Sam will send the report by Friday"' });
  notes.value = m.notes; const preview = h('div', { id: 'preview' }), errBox = h('div', { class: 'err', id: 'form-error', role: 'alert' });
  const update = () => { const ts = day.value ? extractTasks(notes.value, day.value) : []; preview.replaceChildren(); add(preview, [h('h2', null, `Detected action items (${ts.length})`), ts.length ? ts.map((t) => h('div', { class: 'card', 'data-preview': '' }, h('div', null, t.text), h('div', { class: 'meta' }, h('span', { class: 'chip' }, t.owner ? '@' + t.owner : 'unassigned'), h('span', { class: 'chip' }, t.due ? fmt(t.due) : 'no date'), h('span', null, `line ${t.line}`)))) : h('p', { class: 'empty' }, 'Nothing detected yet.')]); };
  notes.addEventListener('input', update); day.addEventListener('input', update); update();
  const save = async (e) => { e.preventDefault(); errBox.textContent = ''; try { const r = await api(id ? 'PUT' : 'POST', id ? `/meetings/${id}` : '/meetings', { title: title.value, day: day.value, notes: notes.value }); toast('Saved'); location.hash = `#/meetings/${r.id}`; } catch (er) { errBox.textContent = er.details ? Object.values(er.details).join(' · ') : er.message; } };
  render(h('h1', null, id ? 'Edit meeting' : 'New meeting'), h('form', { onsubmit: save }, h('div', { class: 'grid' }, h('div', null, h('label', { for: 'title' }, 'Title'), title), h('div', null, h('label', { for: 'day' }, 'Meeting date'), day)),
    h('div', { class: 'grid' }, h('div', null, h('label', { for: 'notes' }, 'Notes'), notes), preview), errBox, h('p', null, h('button', { class: 'primary', id: 'save' }, 'Save & extract tasks'), ' ', id ? h('button', { type: 'button', class: 'danger', id: 'delete', onclick: async () => { if (!confirm('Delete this meeting and its tasks?')) return; await api('DELETE', `/meetings/${id}`); location.hash = '#/meetings'; } }, 'Delete') : null)));
}

async function meetingView(id) {
  const load = async () => draw(await api('GET', `/meetings/${id}?today=${localToday()}`));
  const draw = (m) => render(h('h1', null, m.title), h('p', { class: 'meta' }, h('span', null, m.day), h('a', { href: `#/meetings/${id}/edit` }, 'Edit notes')), h('h2', null, `Action items (${m.tasks.length})`), m.tasks.length ? m.tasks.map((t) => taskRow(t, load)) : h('p', { class: 'empty' }, 'No action items were found in these notes.'), h('h2', null, 'Notes'), h('pre', { class: 'card', id: 'raw-notes' }, m.notes));
  await load();
}

let routing = Promise.resolve();
async function doRoute() {
  const [path, qs] = location.hash.slice(1).split('?'), parts = path.split('/').filter(Boolean), sp = new URLSearchParams(qs || '');
  document.getElementById('nav-tasks').removeAttribute('aria-current'); document.getElementById('nav-meetings').removeAttribute('aria-current');
  try {
    if (!parts.length) { document.getElementById('nav-tasks').setAttribute('aria-current', 'page'); await tasksView(sp); }
    else if (parts[0] === 'meetings') { document.getElementById('nav-meetings').setAttribute('aria-current', 'page'); if (!parts[1]) await meetingsView(); else if (parts[2] === 'edit') await editorView(Number(parts[1])); else await meetingView(Number(parts[1])); }
    else if (parts[0] === 'new') await editorView(null);
    else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back to tasks'));
  } catch (e) { render(h('h1', null, 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back to tasks')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
