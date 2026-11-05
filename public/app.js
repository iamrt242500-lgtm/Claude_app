// Hindsight SPA — vanilla JS, no innerHTML with user data (XSS-safe by construction).
const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids.map((k) => (typeof k === 'string' ? document.createTextNode(k) : k)));
  return el;
};

function toast(msg, type = '') {
  const t = h('div', { class: 'toast ' + type }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3500);
}

class ApiError extends Error { constructor(m, details, status) { super(m); this.details = details; this.status = status; } }
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch('/api' + path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch { throw new ApiError('Network error — check your connection and try again.', null, 0); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, data.details, res.status);
  return data;
}

const fmtPct = (v) => (v == null ? '—' : v + '%');
const outcomeLabel = { hit: 'Hit', partial: 'Partly', miss: 'Miss' };
const isDue = (d) => d.status === 'open' && d.reviewOn <= today();

function pills(d) {
  return [
    d.status === 'reviewed' ? h('span', { class: 'pill ' + d.outcome }, outcomeLabel[d.outcome]) : isDue(d) ? h('span', { class: 'pill due' }, 'Review due') : h('span', { class: 'pill' }, 'Open'),
    h('span', { class: 'pill' }, `${d.confidence}% sure`),
    d.tags.map((t) => h('span', { class: 'pill' }, '#' + t)),
  ];
}
function decisionItem(d) {
  return h('li', { class: 'item' },
    h('div', {}, h('a', { class: 'title', href: `#/d/${d.id}` }, d.title),
      h('div', { class: 'small muted' }, `Decided ${d.decidedAt} · review ${d.reviewOn}`)),
    h('div', {}, pills(d)));
}
const loading = () => main.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
function errorView(e, retry) {
  main.replaceChildren(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: retry }, 'Retry')));
}

/* ---------- views ---------- */
async function viewHome() {
  const [list, stats] = await Promise.all([api('/decisions'), api('/stats')]);
  const due = list.filter(isDue).sort((a, b) => a.reviewOn.localeCompare(b.reviewOn));
  const upcoming = list.filter((d) => d.status === 'open' && !isDue(d)).sort((a, b) => a.reviewOn.localeCompare(b.reviewOn)).slice(0, 5);
  main.replaceChildren(
    h('h1', {}, 'Overview'),
    h('div', { class: 'grid' },
      stat(stats.total, 'Decisions logged'), stat(stats.reviewed, 'Reviewed'), stat(due.length, 'Due for review'),
      stat(fmtPct(stats.hitRate), 'Hit rate'), stat(stats.brier ?? '—', 'Brier score (lower = better)')),
    list.length === 0
      ? h('div', { class: 'card empty' }, h('h2', {}, 'Start your decision journal'),
        h('p', {}, 'Write down a decision, what you expect to happen, and how sure you are. Review it later to learn how well-calibrated you are.'),
        h('a', { class: 'btn primary', href: '#/new' }, 'Log your first decision'),
        ' ', h('button', { class: 'btn', id: 'seed', onclick: seedSamples }, 'Load sample decisions'))
      : h('div', {},
        h('section', { class: 'card' }, h('h2', {}, 'Due for review'),
          due.length ? h('ul', { class: 'list' }, due.map(decisionItem)) : h('p', { class: 'muted' }, 'Nothing is due. Nice.')),
        h('section', { class: 'card' }, h('h2', {}, 'Coming up'),
          upcoming.length ? h('ul', { class: 'list' }, upcoming.map(decisionItem)) : h('p', { class: 'muted' }, 'No upcoming reviews.')),
      ));
}
const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, l));

async function seedSamples() {
  const t = today();
  const samples = [
    ['[Sample] Ship the redesign before the conference', 'Team is split on timing.', 'Ship in two weeks', 'Signups rise at least 10%', 70, -20, -5, ['sample', 'work']],
    ['[Sample] Take the contract job', 'Pays well but is short-term.', 'Accept', 'I will finish on time and get a renewal', 60, -10, 20, ['sample', 'career']],
  ];
  try {
    for (const [title, context, choice, prediction, confidence, d, r, tags] of samples)
      await api('/decisions', { method: 'POST', body: { title, context, choice, prediction, confidence, decidedAt: addDays(t, d), reviewOn: addDays(t, r), tags } });
    toast('Sample decisions added (tagged "sample")'); route();
  } catch (e) { toast(e.message, 'error'); }
}

async function viewJournal() {
  const list = await api('/decisions');
  const f = { q: '', status: 'all', tag: 'all' };
  const tags = [...new Set(list.flatMap((d) => d.tags))].sort();
  const out = h('div');
  const render = () => {
    const rows = list.filter((d) =>
      (f.status === 'all' || (f.status === 'due' ? isDue(d) : d.status === f.status)) &&
      (f.tag === 'all' || d.tags.includes(f.tag)) &&
      (!f.q || [d.title, d.context, d.prediction, d.choice].join(' ').toLowerCase().includes(f.q.toLowerCase())));
    out.replaceChildren(rows.length
      ? h('div', { class: 'card' }, h('ul', { class: 'list' }, rows.map(decisionItem)))
      : h('div', { class: 'card empty' }, list.length ? 'No decisions match these filters.' : 'No decisions yet.'));
  };
  main.replaceChildren(
    h('div', { class: 'row between' }, h('h1', {}, 'Journal'),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '/api/export?format=csv', download: '' }, 'Export CSV'), h('a', { class: 'btn', href: '/api/export', download: '' }, 'Export JSON'))),
    h('div', { class: 'filters' },
      h('input', { type: 'search', placeholder: 'Search…', 'aria-label': 'Search decisions', id: 'q', oninput: (e) => { f.q = e.target.value; render(); } }),
      h('select', { 'aria-label': 'Status filter', id: 'status', onchange: (e) => { f.status = e.target.value; render(); } },
        ['all', 'open', 'due', 'reviewed'].map((v) => h('option', { value: v }, v === 'all' ? 'All statuses' : v[0].toUpperCase() + v.slice(1)))),
      h('select', { 'aria-label': 'Tag filter', id: 'tag', onchange: (e) => { f.tag = e.target.value; render(); } },
        h('option', { value: 'all' }, 'All tags'), tags.map((t) => h('option', { value: t }, '#' + t)))),
    out);
  render();
}

function field(label, control, name, errors) {
  return h('label', {}, label, control, errors?.[name] && h('span', { class: 'err', role: 'alert' }, errors[name]));
}
function viewForm(existing) {
  const d = existing || { title: '', context: '', choice: '', prediction: '', confidence: 70, decidedAt: today(), reviewOn: addDays(today(), 30), tags: [] };
  let errors = {}; let banner = '';
  const draw = (vals = d) => {
    const conf = h('input', { type: 'range', min: 50, max: 99, name: 'confidence', value: vals.confidence, 'aria-describedby': 'conf-out' });
    const out = h('span', { id: 'conf-out', class: 'muted' }, `${vals.confidence}%`);
    conf.addEventListener('input', () => { out.textContent = conf.value + '%'; });
    const form = h('form', { novalidate: true, onsubmit: submit },
      banner && h('div', { class: 'banner', role: 'alert' }, banner),
      field('Decision', h('input', { name: 'title', value: vals.title, maxlength: 200, required: true, placeholder: 'What are you deciding?' }), 'title', errors),
      field('Context (why now, options considered)', h('textarea', { name: 'context' }, vals.context), 'context', errors),
      field('What did you choose?', h('input', { name: 'choice', value: vals.choice }), 'choice', errors),
      field('What do you expect to happen?', h('textarea', { name: 'prediction', placeholder: 'Be specific enough that you can later tell if you were right.' }, vals.prediction), 'prediction', errors),
      h('label', {}, 'Confidence that your prediction is right', h('div', { class: 'row' }, conf, out), errors.confidence && h('span', { class: 'err', role: 'alert' }, errors.confidence)),
      h('div', { class: 'two' },
        field('Decision date', h('input', { type: 'date', name: 'decidedAt', value: vals.decidedAt }), 'decidedAt', errors),
        field('Review on', h('input', { type: 'date', name: 'reviewOn', value: vals.reviewOn }), 'reviewOn', errors)),
      field('Tags (comma separated)', h('input', { name: 'tags', value: vals.tags.join(', ') }), 'tags', errors),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', id: 'save' }, existing ? 'Save changes' : 'Log decision'),
        h('a', { class: 'btn', href: existing ? `#/d/${existing.id}` : '#/journal' }, 'Cancel')));
    main.replaceChildren(h('h1', {}, existing ? 'Edit decision' : 'New decision'), h('div', { class: 'card' }, form));
    const first = $('[aria-invalid], .err', main)?.closest('label')?.querySelector('input,textarea');
    if (first) first.focus();
  };
  async function submit(e) {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.confidence = Number(fd.confidence);
    const btn = $('#save'); btn.disabled = true;
    try {
      const saved = await api(existing ? `/decisions/${existing.id}` : '/decisions', { method: existing ? 'PUT' : 'POST', body: fd });
      toast(existing ? 'Changes saved' : 'Decision logged');
      location.hash = `#/d/${saved.id}`;
    } catch (err) {
      errors = err.details || {}; banner = err.details ? 'Please fix the highlighted fields.' : err.message;
      draw({ ...fd, tags: String(fd.tags).split(',').map((s) => s.trim()).filter(Boolean) });
    }
  }
  draw();
}

async function viewDetail(id) {
  const d = await api('/decisions/' + id);
  const row = (k, v) => v && h('div', {}, h('h3', {}, k), h('p', { class: 'pre' }, v));
  let reviewBox = null;
  if (d.status === 'open') {
    let err = '';
    const form = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      if (!fd.outcome) { err = 'Choose an outcome'; $('#rerr').textContent = err; return; }
      try { await api(`/decisions/${id}/review`, { method: 'POST', body: fd }); toast('Review saved'); route(); }
      catch (x) { toast(x.message, 'error'); }
    } },
      h('fieldset', { class: 'card' }, h('legend', {}, 'How did it turn out?'),
        h('div', { class: 'row' }, ['hit', 'partial', 'miss'].map((o) => h('label', { class: 'row' }, h('input', { type: 'radio', name: 'outcome', value: o }), { hit: 'Prediction was right', partial: 'Partly right', miss: 'Prediction was wrong' }[o]))),
        h('span', { class: 'err', id: 'rerr', role: 'alert' })),
      field('What happened? What would you do differently?', h('textarea', { name: 'outcomeNote' }), 'outcomeNote', {}),
      h('div', {}, h('button', { class: 'btn primary', type: 'submit' }, 'Save review')));
    reviewBox = h('section', { class: 'card' }, h('h2', {}, isDue(d) ? 'Review is due' : 'Review early'), form);
  } else {
    reviewBox = h('section', { class: 'card' }, h('h2', {}, 'Review'),
      h('p', {}, h('span', { class: 'pill ' + d.outcome }, outcomeLabel[d.outcome]), ` Reviewed ${d.reviewedAt}`),
      d.outcomeNote && h('p', { class: 'pre' }, d.outcomeNote),
      h('button', { class: 'btn', onclick: async () => { try { await api(`/decisions/${id}/reopen`, { method: 'POST' }); toast('Reopened'); route(); } catch (x) { toast(x.message, 'error'); } } }, 'Reopen'));
  }
  const dlg = h('dialog', { 'aria-labelledby': 'dt' },
    h('h2', { id: 'dt' }, 'Delete this decision?'), h('p', { class: 'muted' }, 'This cannot be undone.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', id: 'confirm-del', onclick: async () => { try { await api('/decisions/' + id, { method: 'DELETE' }); toast('Decision deleted'); location.hash = '#/journal'; } catch (x) { dlg.close(); toast(x.message, 'error'); } } }, 'Delete'),
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
  main.replaceChildren(
    h('div', { class: 'row between' }, h('h1', {}, d.title),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/d/${id}/edit` }, 'Edit'), h('button', { class: 'btn danger', id: 'del', onclick: () => dlg.showModal() }, 'Delete'))),
    h('p', {}, pills(d), h('span', { class: 'small muted' }, ` Decided ${d.decidedAt} · review ${d.reviewOn}`)),
    h('section', { class: 'card' }, row('Context', d.context), row('Choice', d.choice), row('Prediction', d.prediction)),
    reviewBox, dlg);
}

async function viewCalibration() {
  const s = await api('/stats');
  if (!s.reviewed) {
    main.replaceChildren(h('h1', {}, 'Calibration'), h('div', { class: 'card empty' }, 'Review some decisions to see how your confidence compares with reality.', h('p', {}, h('a', { class: 'btn', href: '#/journal' }, 'Go to journal'))));
    return;
  }
  const W = 560, H = 320, L = 44, B = 36, T = 12, R = 12, pw = W - L - R, ph = H - T - B;
  const x = (v) => L + ((v - 50) / 50) * pw, y = (v) => T + ph - (v / 100) * ph;
  const chart = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Calibration chart: hit rate by confidence bucket against the perfect-calibration diagonal' });
  for (const v of [0, 25, 50, 75, 100]) chart.append(svg('line', { class: 'grid-l', x1: L, x2: W - R, y1: y(v), y2: y(v) }), svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, v + '%'));
  for (const v of [50, 60, 70, 80, 90, 100]) chart.append(svg('text', { x: x(v), y: H - 14, 'text-anchor': 'middle' }, String(v)));
  chart.append(svg('text', { x: L + pw / 2, y: H - 1, 'text-anchor': 'middle' }, 'Stated confidence (%)'));
  const bw = pw / 5 - 8;
  for (const b of s.buckets) if (b.count) chart.append(svg('rect', { class: 'bar', x: x(b.lo) + 4, y: y(b.hitRate), width: bw, height: Math.max(0, y(0) - y(b.hitRate)), rx: 3 }, svg('title', {}, `${b.range}%: ${b.hitRate}% hit rate (${b.count} decisions)`)));
  chart.append(svg('line', { class: 'diag', x1: x(50), y1: y(50), x2: x(100), y2: y(100) }));
  const verdict = { 'well-calibrated': 'Your confidence closely tracks reality.', overconfident: 'You tend to be overconfident: you are right less often than you expect.', underconfident: 'You tend to be underconfident: you are right more often than you expect.' }[s.verdict] || 'Review at least 5 decisions for a verdict.';
  main.replaceChildren(h('h1', {}, 'Calibration'),
    h('div', { class: 'grid' }, stat(s.reviewed, 'Reviewed'), stat(fmtPct(s.avgConfidence), 'Avg confidence'), stat(fmtPct(s.hitRate), 'Actual hit rate'), stat(s.brier, 'Brier score')),
    h('section', { class: 'card' }, h('p', { id: 'verdict' }, h('strong', {}, verdict)), chart, h('p', { class: 'small muted' }, 'Bars: actual hit rate (partly right counts as half). Dashed line: perfect calibration.')),
    h('section', { class: 'card' }, h('h2', {}, 'By confidence bucket'),
      h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Confidence', 'Decisions', 'Avg stated', 'Actual hit rate'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, s.buckets.map((b) => h('tr', {}, h('td', {}, b.range + '%'), h('td', {}, String(b.count)), h('td', {}, fmtPct(b.avgConfidence)), h('td', {}, fmtPct(b.hitRate)))))))));
}

/* ---------- router ---------- */
async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  document.querySelectorAll('nav a').forEach((a) => {
    const k = a.dataset.nav, on = (k === 'home' && hash === '/') || (k === 'journal' && (hash === '/journal' || hash.startsWith('/d/'))) || (k === 'calibration' && hash === '/calibration');
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  const run = async () => {
    let m;
    if (hash === '/') return viewHome();
    if (hash === '/journal') return viewJournal();
    if (hash === '/calibration') return viewCalibration();
    if (hash === '/new') return viewForm();
    if ((m = hash.match(/^\/d\/(\d+)\/edit$/))) return viewForm(await api('/decisions/' + m[1]));
    if ((m = hash.match(/^\/d\/(\d+)$/))) return viewDetail(m[1]);
    main.replaceChildren(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  };
  loading();
  try { await run(); } catch (e) {
    if (e.status === 404) main.replaceChildren(h('div', { class: 'card empty' }, h('h2', {}, 'Not found'), h('p', {}, e.message), h('a', { class: 'btn', href: '#/journal' }, 'Back to journal')));
    else errorView(e, route);
  }
  main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
route();
