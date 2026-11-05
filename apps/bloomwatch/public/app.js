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
const when = (p) => (p.daysLeft < 0 ? `${-p.daysLeft} day${p.daysLeft === -1 ? '' : 's'} late` : p.daysLeft === 0 ? 'today' : p.daysLeft === 1 ? 'tomorrow' : `in ${p.daysLeft} days`);

async function todayView() {
  const t = await api('GET', '/today'), water = async (p) => { try { await api('POST', `/plants/${p.id}/water`, {}); toast(`Watered ${p.name}`); await route(); } catch (e) { toast(errText(e)); } };
  const card = (p) => h('div', { class: 'card plant', 'data-plant': p.name }, h('div', { class: 'info' }, h('strong', null, p.name), p.location ? h('span', { class: 'meta' }, ` · ${p.location}`) : null, h('div', { class: 'meta' }, p.lastWatered ? `last watered ${fmt(p.lastWatered)}` : 'never watered', ` · every ${p.currentInterval} days in ${p.season}`)), h('span', { class: 'chip ' + p.status }, when(p)), h('button', { class: 'primary', 'aria-label': `Water ${p.name}`, onclick: () => water(p) }, '💧 Watered'));
  const sect = (title, id, list) => (list.length ? h('section', { id }, h('h2', null, `${title} (${list.length})`), list.map(card)) : null);
  render(h('h1', null, 'Today'), h('p', { class: 'meta', id: 'info' }, `${fmt(t.today)} · ${t.season} · ${t.total} plant${t.total === 1 ? '' : 's'}`), t.total === 0 ? h('p', { class: 'empty' }, 'No plants yet — add one under Plants.') : null, sect('Overdue', 'overdue', t.overdue), sect('Water today', 'due-today', t.today_), sect('Coming up', 'soon', t.soon), t.ok.length ? h('section', { id: 'ok' }, h('h2', null, `All good (${t.ok.length})`), t.ok.map(card)) : null,
    t.total && !t.overdue.length && !t.today_.length ? h('p', { class: 'meta', id: 'nothing' }, 'Nothing needs water today 🌿') : null);
}
async function plantsView() {
  const [plants, settings] = await Promise.all([api('GET', '/plants'), api('GET', '/settings')]);
  const name = h('input', { id: 'name', maxlength: 60 }), species = h('input', { id: 'species', maxlength: 60 }), loc = h('input', { id: 'location', maxlength: 40, size: 12 }), every = h('input', { id: 'every', type: 'number', min: 1, max: 90, value: 7, size: 3 }), seasonal = h('input', { id: 'seasonal', type: 'checkbox', checked: true }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
  const south = h('input', { id: 'south', type: 'checkbox', checked: settings.southern, onchange: async () => { await api('PUT', '/settings', { southern: south.checked }); toast('Saved'); } });
  render(h('h1', null, 'Plants'), h('form', { class: 'card', onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; try { const p = await api('POST', '/plants', { name: name.value, species: species.value, location: loc.value, everyDays: Number(every.value), seasonal: seasonal.checked }); location.hash = `#/plant/${p.id}`; } catch (e) { err.textContent = errText(e); } } }, h('div', { class: 'row' }, h('div', null, h('label', { for: 'name' }, 'Name'), name), h('div', null, h('label', { for: 'species' }, 'Species'), species), h('div', null, h('label', { for: 'location' }, 'Where'), loc), h('div', null, h('label', { for: 'every' }, 'Water every (days)'), every)), h('label', null, seasonal, ' Water less in winter, more in summer'), err, h('button', { class: 'primary' }, 'Add plant')),
    h('label', null, south, ' I live in the southern hemisphere (flip the seasons)'),
    plants.length ? plants.map((p) => h('a', { class: 'card', href: `#/plant/${p.id}`, 'data-plant': p.name }, h('strong', null, p.name), p.species ? h('span', { class: 'meta' }, ` · ${p.species}`) : null, ' ', h('span', { class: 'chip ' + p.status }, p.archived ? 'archived' : when(p)))) : h('p', { class: 'empty' }, 'No plants yet.'));
}
async function plantView(id) {
  const load = async () => draw(await api('GET', `/plants/${id}`));
  function draw(p) {
    const day = h('input', { id: 'wday', type: 'date', value: localToday(), min: p.added, max: localToday(), 'aria-label': 'Watering date' }), note = h('input', { id: 'wnote', maxlength: 100, placeholder: 'note', 'aria-label': 'Note' }), every = h('input', { id: 'every', type: 'number', min: 1, max: 90, value: p.everyDays, 'aria-label': 'Water every (days)' }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
    render(h('h1', null, p.name), h('p', { class: 'meta' }, [p.species, p.location].filter(Boolean).join(' · ') || '—'), h('p', { id: 'status' }, p.archived ? 'Archived.' : `${p.lastWatered ? `Last watered ${fmt(p.lastWatered)}.` : 'Never watered.'} Next: ${fmt(p.nextWatering)} (${when(p)}). Now every ${p.currentInterval} days (${p.season}${p.seasonal ? '' : ', fixed interval'}).`),
      p.adherence ? h('p', { class: 'meta', id: 'adherence' }, `Recent average gap ${p.adherence.meanGap} days — ${p.adherence.drift > 0 ? `${p.adherence.drift} later` : p.adherence.drift < 0 ? `${-p.adherence.drift} earlier` : 'right on'} than the ${p.everyDays}-day plan.`) : null,
      p.archived ? null : h('form', { class: 'card row', onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; try { await api('POST', `/plants/${id}/water`, { day: day.value, note: note.value }); toast('Logged'); await load(); } catch (e) { err.textContent = errText(e); } } }, h('div', null, h('label', { for: 'wday' }, 'Watered on'), day), h('div', null, h('label', { for: 'wnote' }, 'Note'), note), h('button', { class: 'primary', id: 'water' }, 'Log watering'), err),
      h('div', { class: 'row' }, h('label', { for: 'every' }, 'Base interval'), every, h('button', { id: 'save-every', onclick: async () => { try { await api('PATCH', `/plants/${id}`, { everyDays: Number(every.value) }); await load(); } catch (e) { toast(errText(e)); } } }, 'Save')),
      h('h2', null, 'History'), p.history.length ? h('ul', { id: 'history' }, p.history.map((w) => h('li', { 'data-day': w.day }, `${fmt(w.day)}${w.note ? ` — ${w.note}` : ''} `, h('button', { 'aria-label': `Remove watering ${w.day}`, onclick: async () => { await api('DELETE', `/plants/${id}/water/${w.day}`); await load(); } }, '✕')))) : h('p', { class: 'empty' }, 'No waterings yet.'),
      h('p', null, h('a', { href: '#/plants' }, '← Plants'), ' ', h('button', { id: 'archive', onclick: async () => { await api('PATCH', `/plants/${id}`, { archived: !p.archived }); await load(); } }, p.archived ? 'Restore' : 'Archive'), ' ', h('button', { class: 'danger', id: 'delete', onclick: async () => { if (!confirm('Delete this plant?')) return; await api('DELETE', `/plants/${id}`); location.hash = '#/plants'; } }, 'Delete')));
  }
  await load();
}
let routing = Promise.resolve();
async function doRoute() {
  const parts = location.hash.slice(1).split('?')[0].split('/').filter(Boolean); document.getElementById('nav-today').removeAttribute('aria-current'); document.getElementById('nav-plants').removeAttribute('aria-current');
  try { if (!parts.length) { document.getElementById('nav-today').setAttribute('aria-current', 'page'); await todayView(); } else if (parts[0] === 'plants') { document.getElementById('nav-plants').setAttribute('aria-current', 'page'); await plantsView(); } else if (parts[0] === 'plant' && parts[1]) await plantView(Number(parts[1])); else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back')); }
  catch (e) { render(h('h1', null, e.status === 404 ? 'Not found' : 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
