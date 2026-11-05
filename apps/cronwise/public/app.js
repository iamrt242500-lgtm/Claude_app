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
const PRESETS = [['Every minute', '* * * * *'], ['Every 15 min', '*/15 * * * *'], ['Hourly', '0 * * * *'], ['Daily 03:00', '0 3 * * *'], ['Weekdays 09:00', '0 9 * * 1-5'], ['Weekly Sun', '0 0 * * 0'], ['Monthly', '0 0 1 * *'], ['@yearly', '@yearly']];
const fmtUtc = (iso) => iso.replace('T', ' ').slice(0, 16) + ' UTC';
const fmtLocal = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const LABELS = ['minute', 'hour', 'day', 'month', 'weekday'];

const state = { editing: null, seq: 0, last: null };
const exprIn = h('input', { id: 'expr', 'aria-label': 'Cron expression', value: '*/15 * * * *', spellcheck: 'false', autocomplete: 'off', 'aria-describedby': 'result' });
const labelIn = h('input', { id: 'label', maxlength: 80, placeholder: 'e.g. Nightly backup' });
const result = h('div', { id: 'result', role: 'status' }), fields = h('div', { class: 'fields', 'aria-hidden': 'true' }), runs = h('div'), saveErr = h('div', { class: 'err', role: 'alert' });
const saveBtn = h('button', { class: 'btn primary', id: 'save', onclick: save }, 'Save'), cancelBtn = h('button', { class: 'btn', id: 'cancel-edit', onclick: () => setEditing(null), hidden: true }, 'Cancel edit');
const saved = h('div');

let timer;
exprIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(explain, 150); });
async function explain() {
  const my = ++state.seq;
  let r;
  try { r = await api('/explain', { method: 'POST', body: { expr: exprIn.value, count: 8 } }); }
  catch (e) { if (my === state.seq) { result.replaceChildren(h('div', { class: 'result bad' }, e.message)); runs.replaceChildren(); } return; }
  if (my !== state.seq) return; // stale response
  state.last = r;
  if (!r.valid) { result.replaceChildren(h('div', { class: 'result bad' }, r.error)); fields.replaceChildren(); runs.replaceChildren(); saveBtn.disabled = true; return; }
  saveBtn.disabled = false;
  result.replaceChildren(h('div', { class: 'result' }, r.description));
  fields.replaceChildren(...r.expr.split(' ').map((p, i) => h('div', {}, h('b', {}, p), LABELS[i])));
  runs.replaceChildren(h('h2', {}, 'Next runs'), h('table', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'UTC'), h('th', { scope: 'col' }, 'Your time'))),
    h('tbody', {}, r.next.map((t) => h('tr', {}, h('td', {}, fmtUtc(t)), h('td', {}, fmtLocal(t)))))), r.next.length ? null : h('p', { class: 'muted' }, 'No runs within the next 8 years.'));
}
function setEditing(job) {
  state.editing = job; saveErr.textContent = '';
  labelIn.value = job ? job.label : ''; if (job) exprIn.value = job.expr;
  saveBtn.textContent = job ? 'Update job' : 'Save'; cancelBtn.hidden = !job; explain();
}
async function save() {
  saveErr.textContent = ''; saveBtn.disabled = true;
  try {
    const body = { label: labelIn.value, expr: exprIn.value };
    await api(state.editing ? '/jobs/' + state.editing.id : '/jobs', { method: state.editing ? 'PUT' : 'POST', body });
    toast(state.editing ? 'Job updated' : 'Job saved'); labelIn.value = ''; setEditing(null); await loadSaved();
  } catch (e) { saveErr.textContent = e.details ? Object.values(e.details).join(' · ') : e.message; labelIn.focus(); }
  finally { saveBtn.disabled = !state.last?.valid; }
}
async function loadSaved() {
  try {
    const jobs = await api('/jobs');
    saved.replaceChildren(h('h2', {}, `Saved schedules (${jobs.length})`), jobs.length ? h('ul', { class: 'list' }, jobs.map((j) => h('li', { class: 'item' },
      h('div', {}, h('strong', {}, j.label), h('div', {}, h('code', {}, j.expr)), h('div', { class: 'small muted' }, j.description), j.nextRun && h('div', { class: 'small' }, 'Next: ' + fmtLocal(j.nextRun))),
      h('div', { class: 'row' }, h('button', { class: 'btn', 'aria-label': 'Edit ' + j.label, onclick: () => { setEditing(j); labelIn.focus(); } }, 'Edit'),
        h('button', { class: 'btn danger', 'aria-label': 'Delete ' + j.label, onclick: async () => { if (!confirm(`Delete "${j.label}"?`)) return; try { await api('/jobs/' + j.id, { method: 'DELETE' }); if (state.editing?.id === j.id) setEditing(null); toast('Job deleted'); loadSaved(); } catch (e) { toast(e.message, 'error'); } } }, 'Delete')))))
      : h('p', { class: 'empty' }, 'Nothing saved yet.'));
  } catch (e) { saved.replaceChildren(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: loadSaved }, 'Retry'))); }
}
main.append(
  h('section', { class: 'card' }, h('h1', {}, 'Cron expression'), h('label', {}, 'minute  hour  day-of-month  month  day-of-week', exprIn),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Presets' }, PRESETS.map(([l, e]) => h('button', { class: 'chip', onclick: () => { exprIn.value = e; explain(); } }, l))),
    fields, result, h('div', { class: 'row' }, h('label', {}, 'Label', labelIn), saveBtn, cancelBtn), saveErr, h('p', { class: 'small muted' }, 'Times are evaluated in UTC. When both day-of-month and weekday are set, either matching triggers a run (standard cron).'), runs),
  h('aside', { class: 'card' }, saved));
explain(); loadSaved();
