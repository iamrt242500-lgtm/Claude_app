import { charStates, analyze } from './typing.js';
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
const render = (...kids) => main.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const toast = (m, t = '') => { const e = h('div', { class: 'toast ' + t }, m); $('#toasts').append(e); setTimeout(() => e.remove(), 3500); };
class ApiError extends Error { constructor(m, d, s) { super(m); this.details = d; this.status = s; } }
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(path, opts = {}) {
  let res; const sep = path.includes('?') ? '&' : '?';
  try { res = await fetch('/api' + path + sep + 'today=' + localToday(), { method: opts.method, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new ApiError('Network error — check your connection and try again.', null, 0); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, data.details, res.status);
  return data;
}
const svgEl = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
const prefs = (() => { try { return { level: 'easy', ...JSON.parse(localStorage.getItem('typo.prefs') || '{}') }; } catch { return { level: 'easy' }; } })();
const savePrefs = () => { try { localStorage.setItem('typo.prefs', JSON.stringify(prefs)); } catch { /* optional */ } };

/* ---------- practice ---------- */
let cleanup = null;
async function viewPractice() {
  const passages = await api('/passages'); let passage = null;
  const pick = () => { const pool = passages.filter((p) => p.level === prefs.level); const prev = passage?.id; let n; do { n = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && n.id === prev); return n; };
  const stage = h('div'); let resultBox = h('div');
  const st = { target: '', typed: '', start: null, last: null, events: [], keystrokes: 0, wrong: 0, done: false, timer: null };
  const input = h('input', { type: 'text', class: 'hiddeninput', id: 'typing-input', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Type the text shown above' });
  const prompt = h('div', { class: 'prompt', id: 'prompt', role: 'textbox', 'aria-readonly': 'true', 'aria-label': 'Text to type', tabindex: '-1', onclick: () => input.focus() });
  const liveWpm = h('b', { id: 'live-wpm' }, '0'), liveAcc = h('b', { id: 'live-acc' }, '100%'), liveTime = h('b', { id: 'live-time' }, '0.0s'), livePct = h('b', { id: 'live-pct' }, '0%');

  const paint = () => { const states = charStates(st.target, st.typed), cur = st.typed.length; prompt.replaceChildren(...[...st.target].map((c, i) => h('span', { class: 'c ' + states[i] + (i === cur && !st.done ? ' cur' : ''), 'data-i': i }, c === ' ' ? ' ' : c))); };
  const live = () => { const ms = st.start ? Date.now() - st.start : 0, a = analyze(st.target, st.typed, ms, { keystrokes: st.keystrokes, wrongKeystrokes: st.wrong }); liveWpm.textContent = String(Math.round(a.wpm)); liveAcc.textContent = a.accuracy + '%'; liveTime.textContent = (ms / 1000).toFixed(1) + 's'; livePct.textContent = Math.round((st.typed.length / [...st.target].length) * 100) + '%'; };
  const reset = (newPassage = true) => {
    clearInterval(st.timer); if (newPassage || !passage) passage = pick(); Object.assign(st, { target: passage.text, typed: '', start: null, last: null, events: [], keystrokes: 0, wrong: 0, done: false }); input.value = ''; resultBox.replaceChildren(); paint(); live(); input.focus();
    stage.querySelector('#passage-title') && (stage.querySelector('#passage-title').textContent = `${passage.title} · ${passage.level}`);
  };
  const finish = async () => {
    st.done = true; clearInterval(st.timer); paint(); const ms = Math.max(1, st.last - st.start), a = analyze(st.target, st.typed, ms, { keystrokes: st.keystrokes, wrongKeystrokes: st.wrong }); live(); liveTime.textContent = (ms / 1000).toFixed(1) + 's';
    const mist = {}; for (const e of st.events) if (!e.ok) mist[e.expected] = (mist[e.expected] || 0) + 1;
    resultBox.replaceChildren(h('div', { class: 'card', id: 'result' }, h('p', { class: 'muted' }, 'Saving result…')));
    try {
      const r = await api('/results', { method: 'POST', body: { passageId: passage.id, durationMs: Math.round(ms), typedChars: [...st.typed].length, correctChars: a.correct, keystrokes: st.keystrokes, wrongKeystrokes: st.wrong, mistakes: mist } });
      resultBox.replaceChildren(h('div', { class: 'card', id: 'result', role: 'status' }, h('h2', {}, 'Finished!', r.personalBest ? h('span', { class: 'pb', id: 'pb' }, r.previousBest == null ? 'first result' : 'new best!') : null),
        h('div', { class: 'res' }, [[r.wpm, 'WPM (net)'], [r.rawWpm, 'Raw WPM'], [r.accuracy + '%', 'Accuracy'], [(r.durationMs / 1000).toFixed(1) + 's', 'Time']].map(([v, l]) => h('div', {}, h('b', {}, String(v)), h('span', {}, l)))),
        Object.keys(r.mistakes).length ? h('p', { class: 'small muted', id: 'mistakes' }, 'Missed most: ', Object.entries(r.mistakes).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k === ' ' ? '␣' : k} ×${v}`).join(', ')) : h('p', { class: 'small', id: 'mistakes' }, 'No mistakes — clean run!'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'next', onclick: () => reset(true) }, 'Next passage (Tab)'), h('button', { class: 'btn', id: 'retry', onclick: () => reset(false) }, 'Retry this one'), h('a', { class: 'btn', href: '#/progress' }, 'Progress'))));
      $('#next')?.focus();
    } catch (x) { resultBox.replaceChildren(h('div', { class: 'banner', role: 'alert' }, x.details ? Object.values(x.details)[0] : x.message, ' ', h('button', { class: 'btn', onclick: () => reset(false) }, 'Retry'))); }
  };
  input.addEventListener('beforeinput', (e) => { if (st.done) { e.preventDefault(); return; } if (e.inputType && /^(insertFromPaste|insertFromDrop|insertReplacementText)/.test(e.inputType)) { e.preventDefault(); toast('Pasting is disabled — type it out!'); } });
  input.addEventListener('input', (e) => {
    if (st.done) { input.value = ''; return; }
    const v = input.value, cps = [...v], before = [...st.typed];
    if (cps.length > [...st.target].length) { input.value = st.typed; return; }
    const now = Date.now(); if (!st.start && cps.length) { st.start = now; st.timer = setInterval(live, 100); }
    if (cps.length > before.length) for (let i = before.length; i < cps.length; i++) { const ok = cps[i] === [...st.target][i]; st.keystrokes++; if (!ok) { st.wrong++; st.events.push({ expected: [...st.target][i], ok: false }); } }
    st.typed = v; st.last = now; paint(); live();
    if (cps.length === [...st.target].length && analyze(st.target, st.typed, 1).uncorrected === 0) finish();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); reset(false); } else if (e.key === 'Tab') { e.preventDefault(); reset(true); } });
  const levelBtn = (l) => h('button', { class: 'btn sm', 'data-level': l, 'aria-pressed': String(prefs.level === l), onclick: () => { prefs.level = l; savePrefs(); stage.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === l))); reset(true); } }, l[0].toUpperCase() + l.slice(1));
  stage.append(h('div', { class: 'row between' }, h('div', { class: 'row', role: 'group', 'aria-label': 'Difficulty' }, ['easy', 'medium', 'hard'].map(levelBtn)), h('span', { class: 'muted small', id: 'passage-title' })),
    h('div', { class: 'card' }, h('div', { class: 'live', 'aria-live': 'off' }, h('div', {}, liveWpm, h('span', {}, 'WPM')), h('div', {}, liveAcc, h('span', {}, 'accuracy')), h('div', {}, liveTime, h('span', {}, 'time')), h('div', {}, livePct, h('span', {}, 'done'))), h('p'), prompt, input,
      h('p', { class: 'small muted' }, 'The timer starts with your first key. Backspace fixes mistakes (they still count against accuracy). ', h('kbd', {}, 'Esc'), ' restarts, ', h('kbd', {}, 'Tab'), ' = next passage.')), resultBox);
  render(h('h1', {}, 'Practice'), stage); reset(true); input.focus();
  cleanup = () => clearInterval(st.timer);
}

/* ---------- progress ---------- */
async function viewProgress() {
  const [s, results] = await Promise.all([api('/stats'), api('/results')]);
  const chart = () => { const W = 600, H = 150, pts = s.trend; const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H + 18}`, role: 'img', 'aria-label': `Net WPM over your last ${pts.length} runs` }); const max = Math.max(20, ...pts.map((p) => p.wpm)) * 1.15, x = (i) => 30 + (pts.length === 1 ? (W - 40) / 2 : (i / (pts.length - 1)) * (W - 40)), y = (v) => H - (v / max) * H;
    for (const g of [0, 0.5, 1]) { svg.append(svgEl('line', { class: 'grid', x1: 30, x2: W - 10, y1: y(max * g), y2: y(max * g) }), svgEl('text', { x: 0, y: y(max * g) + 3 }, String(Math.round(max * g)))); }
    svg.append(svgEl('polyline', { class: 'line', points: pts.map((p, i) => `${x(i)},${y(p.wpm)}`).join(' ') })); pts.forEach((p, i) => { const c = svgEl('circle', { class: 'dot', cx: x(i), cy: y(p.wpm), r: 3.5 }); c.append(svgEl('title', {}, `${p.wpm} WPM · ${p.accuracy}% accuracy`)); svg.append(c); }); return svg; };
  const stat = (v, l) => h('div', {}, h('b', {}, String(v)), h('span', {}, l));
  render(h('div', { class: 'row between' }, h('h1', {}, 'Progress'), results.length ? h('button', { class: 'btn sm danger', id: 'clear', onclick: () => { const d = h('dialog', { 'aria-labelledby': 'cdt' }, h('h2', { id: 'cdt' }, 'Delete all results?'), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-ok', onclick: async () => { d.close(); try { await api('/results', { method: 'DELETE' }); toast('Results cleared'); route(); } catch (x) { toast(x.message, 'error'); } } }, 'Delete all'), h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'))); d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); } }, 'Clear all') : null),
    s.total ? [h('div', { class: 'card' }, h('div', { class: 'res', id: 'summary' }, stat(s.averageWpm, 'Avg WPM (last 10)'), stat(s.averageAccuracy + '%', 'Avg accuracy'), stat(s.streak + (s.streak === 1 ? ' day' : ' days'), 'Practice streak'), stat(s.total, 'Runs'), ...['easy', 'medium', 'hard'].filter((l) => s.best[l]).map((l) => stat(s.best[l].wpm, `Best · ${l}`)))),
      h('div', { class: 'card' }, h('h2', {}, 'WPM over time'), chart()),
      h('div', { class: 'card' }, h('h2', {}, 'Keys to practise'), s.weakKeys.length ? h('div', { class: 'keys', id: 'weak' }, s.weakKeys.map((k) => h('span', { class: 'key', 'data-key': k.ch }, k.ch === ' ' ? '␣' : k.ch, h('small', {}, '×' + k.count)))) : h('p', { class: 'muted' }, 'No mistakes recorded yet — nice!')),
      h('div', { class: 'card' }, h('h2', {}, 'Recent runs'), h('ul', { class: 'list', id: 'history' }, results.slice(0, 15).map((r) => h('li', { class: 'item' }, h('span', {}, `${r.day} · ${r.level}`), h('span', {}, h('strong', {}, `${r.wpm} WPM`), ` · ${r.accuracy}%`), h('button', { class: 'btn sm', 'aria-label': 'Delete result', onclick: async () => { try { await api('/results/' + r.id, { method: 'DELETE' }); route(); } catch (x) { toast(x.message, 'error'); } } }, '✕')))))]
      : h('div', { class: 'card empty' }, h('h2', {}, 'No results yet'), h('a', { class: 'btn primary', href: '#/' }, 'Start practising')));
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  cleanup?.(); cleanup = null;
  const hash = location.hash.slice(1) || '/';
  document.querySelectorAll('nav a').forEach((a) => { const on = a.dataset.nav === (hash === '/progress' ? 'progress' : 'practice'); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  render(h('p', { class: 'muted' }, 'Loading…'));
  try { if (hash === '/') await viewPractice(); else if (hash === '/progress') await viewProgress(); else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home'))); }
  catch (e) { render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry'))); }
}
addEventListener('hashchange', route); route();
