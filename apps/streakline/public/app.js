const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');
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
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(path, opts = {}) {
  let res;
  const sep = path.includes('?') ? '&' : '?';
  try { res = await fetch('/api' + path + sep + 'today=' + localToday(), { method: opts.method, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new ApiError('Network error — check your connection and try again.', null, 0); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, data.details, res.status);
  return data;
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const wd = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
const schedText = (s) => (s.length === 7 ? 'Every day' : s.join() === '1,2,3,4,5' ? 'Weekdays' : s.join() === '0,6' ? 'Weekends' : s.map((d) => DAYS[d]).join(', '));
const streakEl = (n) => h('span', { class: 'streak' + (n >= 3 ? ' hot' : ''), 'aria-label': `${n} day streak` }, `${n >= 3 ? '🔥 ' : ''}${n}`);
const dayPicker = (sel) => h('div', { class: 'days', role: 'group', 'aria-label': 'Days of the week' }, DAYS.map((d, i) => h('label', {}, h('input', { type: 'checkbox', name: 'day', value: i, checked: sel.includes(i) }), d)));
const selectedDays = (form) => [...form.querySelectorAll('input[name=day]:checked')].map((i) => Number(i.value));

async function viewToday() {
  const { today, habits } = await api('/habits');
  $('#today-label').textContent = new Date(today + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const todays = habits.filter((x) => x.scheduledToday), others = habits.filter((x) => !x.scheduledToday);
  let errs = {};
  const row = (x) => {
    const btn = h('button', { class: 'check', 'aria-pressed': String(x.doneToday), 'aria-label': `${x.name}: mark ${x.doneToday ? 'not done' : 'done'} today`, 'data-habit': x.id, onclick: async () => {
      btn.disabled = true;
      try { await api(`/habits/${x.id}/checkins/${today}`, { method: x.doneToday ? 'DELETE' : 'PUT' }); route(); } catch (e) { toast(e.message, 'error'); btn.disabled = false; } } }, x.doneToday ? '✓' : '');
    return h('div', { class: 'habit' }, btn, h('div', { class: 'name' }, h('a', { href: '#/h/' + x.id }, x.name), h('div', { class: 'small muted' }, schedText(x.schedule))), streakEl(x.currentStreak));
  };
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); try { await api('/habits', { method: 'POST', body: { name: new FormData(e.target).get('name'), schedule: selectedDays(e.target) } }); toast('Habit added'); route(); }
    catch (x) { errs = x.details || { name: x.message }; $('#nerr').textContent = errs.name || ''; $('#serr').textContent = errs.schedule || ''; } } },
    h('label', { class: 'f' }, 'New habit', h('input', { type: 'text', name: 'name', id: 'habit-name', maxlength: 80, placeholder: 'e.g. Read 20 minutes' }), h('span', { class: 'err', id: 'nerr', role: 'alert' })),
    dayPicker([0, 1, 2, 3, 4, 5, 6]), h('span', { class: 'err', id: 'serr', role: 'alert' }), h('div', {}, h('button', { class: 'btn primary', id: 'add-habit' }, 'Add habit')));
  const doneN = todays.filter((x) => x.doneToday).length;
  render(h('h1', {}, 'Today'),
    habits.length === 0 ? h('div', { class: 'card empty' }, 'No habits yet. Add your first one below — pick the days it applies to.')
      : h('div', { class: 'card' }, todays.length ? [h('div', { class: 'small muted', id: 'progress' }, `${doneN} of ${todays.length} done`), todays.map(row)] : h('p', { class: 'empty' }, 'Nothing scheduled today. Enjoy the day off!')),
    others.length ? h('div', { class: 'card' }, h('h2', {}, 'Not scheduled today'), others.map(row)) : null,
    h('div', { class: 'card' }, form));
}

async function viewHabit(id) {
  let x = await api('/habits/' + id); const { today } = await api('/habits');
  const draw = () => {
    const doneSet = new Set(x.recent), end = addDays(today, 6 - wd(today)), start = addDays(end, -(12 * 7) + 1), cells = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const future = d > today, isDone = doneSet.has(d), sched = x.schedule.includes(wd(d));
      cells.push(h('button', { class: `cell${isDone ? ' done' : ''}${sched ? '' : ' off'}${future ? ' future' : ''}${d === today ? ' today' : ''}`, 'data-day': d, 'aria-pressed': String(isDone), 'aria-label': `${d}${sched ? '' : ' (not scheduled)'}: ${isDone ? 'done' : 'not done'}`, disabled: future,
        onclick: async () => { try { x = await api(`/habits/${id}/checkins/${d}`, { method: isDone ? 'DELETE' : 'PUT' }); draw(); } catch (e) { toast(e.details?.date || e.message, 'error'); } } }));
    }
    const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, l));
    const dlg = h('dialog', { 'aria-labelledby': 'dt' }, h('h2', { id: 'dt' }, `Delete "${x.name}"?`), h('p', { class: 'muted' }, 'All its history will be removed.'), h('div', { class: 'row' },
      h('button', { class: 'btn danger', id: 'confirm-del', onclick: async () => { try { await api('/habits/' + id, { method: 'DELETE' }); toast('Habit deleted'); location.hash = '#/'; } catch (e) { dlg.close(); toast(e.message, 'error'); } } }, 'Delete'), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
    const edit = h('form', { novalidate: true, onsubmit: async (e) => { e.preventDefault(); try { x = await api('/habits/' + id, { method: 'PUT', body: { name: new FormData(e.target).get('name'), schedule: selectedDays(e.target) } }); toast('Habit saved'); draw(); } catch (err) { $('#eerr').textContent = Object.values(err.details || { e: err.message }).join(' · '); } } },
      h('label', { class: 'f' }, 'Name', h('input', { type: 'text', name: 'name', value: x.name, maxlength: 80 })), dayPicker(x.schedule), h('span', { class: 'err', id: 'eerr', role: 'alert' }), h('div', {}, h('button', { class: 'btn primary', id: 'save-habit' }, 'Save changes')));
    render(h('div', { class: 'row between' }, h('div', {}, h('a', { href: '#/', class: 'small muted' }, '← Today'), h('h1', {}, x.name), h('p', { class: 'muted' }, schedText(x.schedule))), h('button', { class: 'btn danger', id: 'del', onclick: () => dlg.showModal() }, 'Delete')),
      h('div', { class: 'grid' }, stat(x.currentStreak, 'Current streak'), stat(x.longestStreak, 'Longest streak'), stat(x.rate30 == null ? '—' : x.rate30 + '%', 'Last 30 days'), stat(x.total, 'Total check-ins')),
      h('div', { class: 'card' }, h('h2', {}, 'Last 12 weeks'), h('div', { class: 'heat', role: 'group', 'aria-label': 'Check-in calendar' }, cells), h('p', { class: 'small muted' }, 'Click a day to toggle it (backfill past days). Columns are weeks, rows Sunday → Saturday.'),
        h('div', { class: 'legend' }, h('span', {}, h('i', { style: null, class: 'cell' }), 'Not done'), h('span', {}, h('i', { class: 'cell done' }), 'Done'))),
      h('div', { class: 'card' }, h('h2', {}, 'Edit habit'), edit), dlg);
  };
  draw();
}

async function route() {
  const hash = location.hash.slice(1) || '/'; let m;
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewToday(); else if ((m = hash.match(/^\/h\/(\d+)$/))) await viewHabit(m[1]);
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) render(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to today')));
    else render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
