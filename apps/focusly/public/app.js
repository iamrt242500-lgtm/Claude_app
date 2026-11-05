import { formatClock, remainingMs } from './timer.js';
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
const toast = (m, t = '') => { const e = h('div', { class: 'toast ' + t }, m); $('#toasts').append(e); setTimeout(() => e.remove(), 3500); };
class ApiError extends Error { constructor(m, d, s) { super(m); this.details = d; this.status = s; } }
const TZ = new Date().getTimezoneOffset();
async function api(path, opts = {}) {
  let res; const sep = path.includes('?') ? '&' : '?';
  try { res = await fetch('/api' + path + sep + 'tz=' + TZ, { method: opts.method, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new ApiError('Network error — check your connection and try again.', null, 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, data.details, res.status);
  return data;
}

/* ---- per-viewer settings (localStorage is only a convenience) ---- */
const DEFAULTS = { focus: 25, short: 5, long: 15, sound: true };
const loadSettings = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('focusly.settings') || '{}') }; } catch { return { ...DEFAULTS }; } };
const saveSettings = (s) => { try { localStorage.setItem('focusly.settings', JSON.stringify(s)); } catch { /* ignore */ } };
let settings = loadSettings(), kind = 'focus', st = null, skew = 0, label = '', busy = false, tick = null, poll = null, finishedHandled = null;
const LIMITS = { focus: [1, 180], short: [1, 60], long: [1, 120] };
const KIND_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };

function beep() {
  if (!settings.sound) return;
  try { const ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8); o.start(); o.stop(ctx.currentTime + 0.8); } catch { /* audio blocked */ }
}
const serverNow = () => Date.now() + skew;
async function refresh(quiet) {
  try { const before = st?.active?.id; st = await api('/state'); skew = st.now - Date.now(); if (before && !st.active && finishedHandled !== before) { finishedHandled = before; const done = st.history[0]; if (done && done.id === before && done.status === 'completed') { beep(); toast(`${KIND_LABEL[done.kind]} complete 🎉`); } } draw(); }
  catch (e) { if (!st) main.replaceChildren(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: () => refresh() }, 'Retry'))); else if (!quiet) toast(e.message, 'error'); }
}
async function act(fn) { if (busy) return; busy = true; try { st = await fn(); skew = st.now - Date.now(); draw(); } catch (e) { toast(e.details ? Object.values(e.details)[0] : e.message, 'error'); await refresh(true); } finally { busy = false; draw(); } }

function ring(progress, brk) {
  const R = 112, C = 2 * Math.PI * R, mk = (cls, off) => { const c = document.createElementNS(NS, 'circle'); for (const [k, v] of Object.entries({ class: cls, cx: 130, cy: 130, r: R, fill: 'none', 'stroke-width': 12, 'stroke-linecap': 'round', ...(off != null ? { 'stroke-dasharray': C, 'stroke-dashoffset': off } : {}) })) c.setAttribute(k, v); return c; };
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 260 260'); svg.setAttribute('aria-hidden', 'true'); svg.append(mk('track'), mk('prog', C * (1 - progress))); return h('div', { class: 'ring' + (brk ? ' break' : '') }, svg);
}
function chart(days) {
  const W = 420, H = 90, bw = W / days.length, max = Math.max(30, ...days.map((d) => d.minutes)), svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'chart'); svg.setAttribute('viewBox', `0 0 ${W} ${H + 14}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Focus minutes per day, last 14 days');
  days.forEach((d, i) => { const ht = (d.minutes / max) * H, r = document.createElementNS(NS, 'rect'); for (const [k, v] of Object.entries({ class: 'bar', x: i * bw + 2, y: H - ht, width: bw - 4, height: ht, rx: 2 })) r.setAttribute(k, v); const t = document.createElementNS(NS, 'title'); t.textContent = `${d.day}: ${d.minutes} min`; r.append(t); svg.append(r); });
  for (const [i, a] of [[0, 'start'], [days.length - 1, 'end']]) { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', i ? W : 0); t.setAttribute('y', H + 11); t.setAttribute('text-anchor', a); t.textContent = days[i].day.slice(5); svg.append(t); }
  return svg;
}

function draw() {
  if (!st) return;
  const a = st.active, running = !!a, shown = a ? a.kind : kind, mins = a ? a.minutes : settings[kind];
  const left = a ? remainingMs(a.endsAt, serverNow()) : mins * 60000, total = (a ? a.minutes : mins) * 60000;
  const clock = h('div', { class: 'clock', id: 'clock', role: 'timer', 'aria-live': 'off', 'aria-label': `${formatClock(left)} remaining` }, formatClock(left), h('small', {}, a ? KIND_LABEL[a.kind] + (a.label ? ` · ${a.label}` : '') : 'Ready'));
  const r = ring(running ? 1 - left / total : 0, shown !== 'focus'); r.append(clock);
  const labelIn = h('input', { type: 'text', id: 'label', list: 'labels', maxlength: 60, placeholder: 'What are you working on? (optional)', value: running ? a.label : label, disabled: running, 'aria-label': 'Session label', oninput: (e) => { label = e.target.value; } });
  const stats = st.stats;
  const form = h('div', { class: 'card timer' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Session type' }, Object.keys(KIND_LABEL).map((k) => h('button', { 'aria-pressed': String(shown === k), 'data-kind': k, disabled: running, onclick: () => { kind = k; draw(); } }, `${KIND_LABEL[k]} ${settings[k]}m`))),
    r, h('datalist', { id: 'labels' }, st.labels.map((l) => h('option', { value: l }))), h('div', { style: null, class: 'row center' }, labelIn),
    h('div', { class: 'row center' }, running ? h('button', { class: 'btn danger', id: 'stop', disabled: busy, onclick: () => act(() => api('/sessions/stop', { method: 'POST' })) }, 'Stop session') : h('button', { class: 'btn primary', id: 'start', disabled: busy, onclick: () => act(() => api('/sessions/start', { method: 'POST', body: { kind, minutes: settings[kind], label } })) }, `Start ${KIND_LABEL[kind].toLowerCase()}`)));
  const settingsCard = h('details', { class: 'card' }, h('summary', {}, 'Settings'), h('form', { class: 'row', novalidate: true, onsubmit: (e) => { e.preventDefault(); const fd = new FormData(e.target), next = { ...settings, sound: fd.get('sound') === 'on' }, bad = [];
    for (const k of Object.keys(LIMITS)) { const v = Number(fd.get(k)); if (!Number.isInteger(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) bad.push(`${KIND_LABEL[k]}: ${LIMITS[k][0]}–${LIMITS[k][1]} minutes`); else next[k] = v; }
    $('#serr').textContent = bad.join(' · '); if (!bad.length) { settings = next; saveSettings(settings); toast('Settings saved'); draw(); } } },
    ...Object.keys(LIMITS).map((k) => h('label', { class: 'f' }, KIND_LABEL[k] + ' (min)', h('input', { type: 'number', name: k, value: settings[k], min: LIMITS[k][0], max: LIMITS[k][1], style: null }))),
    h('label', { class: 'f' }, 'Sound', h('span', { class: 'row' }, h('input', { type: 'checkbox', name: 'sound', checked: settings.sound }), ' beep when done')), h('button', { class: 'btn' }, 'Save'), h('span', { class: 'err', id: 'serr', role: 'alert' })));
  const statGrid = h('div', { class: 'card' }, h('div', { class: 'grid' }, [[stats.todayMinutes + ' min', 'Focus today'], [stats.todaySessions, 'Sessions today'], [stats.streak + (stats.streak === 1 ? ' day' : ' days'), 'Streak'], [Math.round(stats.totalMinutes / 6) / 10 + ' h', 'Total focus']].map(([v, l]) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, l)))));
  const lower = h('div', { class: 'two' }, h('div', { class: 'card' }, h('h2', {}, 'Last 14 days'), chart(stats.days), stats.labels.length ? h('ul', { class: 'list' }, stats.labels.map((l) => h('li', { class: 'item' }, h('span', {}, l.label), h('span', {}, l.minutes + ' min')))) : null),
    h('div', { class: 'card' }, h('h2', {}, 'Recent sessions'), st.history.length ? h('ul', { class: 'list', id: 'history' }, st.history.map((s) => h('li', { class: 'item' }, h('span', {}, h('span', { class: 'pill ' + (s.status === 'cancelled' ? 'cancelled' : s.kind) }, KIND_LABEL[s.kind]), s.label || '', h('span', { class: 'small muted' }, ` ${s.minutes} min · ${new Date(s.finishedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)),
      h('button', { class: 'btn sm', 'aria-label': 'Delete session', onclick: () => act(() => api('/sessions/' + s.id, { method: 'DELETE' })) }, '✕')))) : h('p', { class: 'empty' }, 'No sessions yet. Start your first focus session!')));
  const keepFocus = document.activeElement?.id === 'label' ? $('#label')?.selectionStart : null;
  main.replaceChildren(form, statGrid, lower, settingsCard);
  if (keepFocus != null) { const l = $('#label'); l.focus(); l.setSelectionRange(keepFocus, keepFocus); }
  document.title = running ? `${formatClock(left)} · ${KIND_LABEL[a.kind]} — Focusly` : 'Focusly — focus timer';
}

// Tick the display every second from the server-corrected clock; finalize and re-sync exactly when time is up.
function startLoops() {
  clearInterval(tick); clearInterval(poll);
  tick = setInterval(() => {
    const a = st?.active; if (!a) return; const left = remainingMs(a.endsAt, serverNow());
    const pg = $('.ring .prog'); if (pg) pg.setAttribute('stroke-dashoffset', String(2 * Math.PI * 112 * (left / (a.minutes * 60000))));
    const c = $('#clock'); if (c) { c.firstChild.nodeValue = formatClock(left); c.setAttribute('aria-label', `${formatClock(left)} remaining`); }
    document.title = `${formatClock(left)} · ${KIND_LABEL[a.kind]} — Focusly`;
    if (left <= 0 && !busy) refresh(true);
  }, 1000);
  poll = setInterval(() => { if (!busy) refresh(true); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
}
await refresh(); startLoops();
