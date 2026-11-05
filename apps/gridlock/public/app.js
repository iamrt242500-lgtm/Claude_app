import { conflicts, peers, isBoard } from '/sudoku.js';
const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 2500); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(method, path, body) {
  const r = await fetch('/api' + path + (path.includes('?') ? '&' : '?') + 'today=' + localToday(), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; throw e; } return j;
}
const fmt = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
let timerHandle = null, keyHandler = null;

async function startView() {
  const games = await api('GET', '/games'), open = games.filter((g) => g.status === 'playing');
  const go = (id) => { location.hash = `#/play/${id}`; };
  const newGame = async (difficulty, daily) => { const p = await api('GET', `/puzzle?difficulty=${difficulty}${daily ? '&daily=1' : ''}`); await api('POST', '/games', { id: p.id }); go(p.id); };
  render(h('h1', null, 'New game'), h('div', { class: 'tools' }, ['easy', 'medium', 'hard'].map((d) => h('button', { class: 'primary', 'data-new': d, onclick: () => newGame(d, false) }, d[0].toUpperCase() + d.slice(1))), h('button', { id: 'daily', onclick: () => newGame('medium', true) }, 'Daily (medium)')),
    h('h2', null, 'In progress'), open.length ? open.map((g) => h('a', { class: 'card', href: `#/play/${g.id}`, 'data-game': g.id }, h('strong', null, g.difficulty), ` · ${fmt(g.seconds)} · ${g.board.split('').filter((c) => c !== '.').length}/81 filled`)) : h('p', { class: 'empty' }, 'No unfinished games.'));
}

async function playView(id) {
  const g = await api('GET', `/games/${id}`); const given = g.puzzle; let board = g.board, sel = -1, noteMode = false, status = g.status, hints = g.hints, wrong = new Set(), elapsed = g.seconds; const notes = new Map(), undo = []; const t0 = Date.now(), base = g.seconds;
  const grid = h('div', { class: 'sudoku', role: 'grid', 'aria-label': 'Sudoku board' }), timerEl = h('div', { class: 'timer', id: 'timer' }), banner = h('div', { id: 'banner' }), noteBtn = h('button', { id: 'notes-toggle', 'aria-pressed': 'false', onclick: () => { noteMode = !noteMode; noteBtn.setAttribute('aria-pressed', String(noteMode)); } }, 'Notes');
  let saving = Promise.resolve();
  const tick = () => { if (status === 'playing') elapsed = Math.max(elapsed, base + Math.floor((Date.now() - t0) / 1000)); timerEl.textContent = fmt(elapsed); };
  const save = () => { saving = saving.then(async () => { try { const r = await api('PUT', `/games/${id}`, { board, seconds: elapsed }); if (r.status === 'solved' && status !== 'solved') { status = 'solved'; draw(); } } catch (e) { if (e.status !== 409) toast(e.message); } }); return saving; };
  function draw() {
    const bad = new Set(conflicts(board)), s = sel >= 0 ? board[sel] : '.'; const near = sel >= 0 ? new Set(peers(sel)) : new Set(); grid.replaceChildren();
    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / 9), c = i % 9, cls = ['cell', 'c' + c, 'r' + r]; if (given[i] !== '.') cls.push('given'); if (i === sel) cls.push('sel'); else if (s !== '.' && board[i] === s) cls.push('same'); else if (near.has(i)) cls.push('peer'); if (bad.has(i)) cls.push('bad'); if (wrong.has(i)) cls.push('wrong');
      const n = notes.get(i); const cell = h('button', { class: cls.join(' '), role: 'gridcell', 'data-i': i, 'data-v': board[i] === '.' ? '' : board[i], 'aria-label': `Row ${r + 1} column ${c + 1} ${board[i] === '.' ? 'empty' : board[i]}${given[i] !== '.' ? ' given' : ''}`, onclick: () => { sel = i; draw(); } }, board[i] !== '.' ? board[i] : n && n.size ? h('div', { class: 'notes' }, '123456789'.split('').map((d) => h('span', null, n.has(d) ? d : ''))) : '');
      grid.append(cell);
    }
    banner.replaceChildren(); if (status === 'solved') add(banner, [h('p', { class: 'win', id: 'win' }, `Solved in ${fmt(elapsed)}${hints ? ` with ${hints} hint${hints > 1 ? 's' : ''}` : ''}!`), h('p', { class: 'tools' }, h('a', { class: 'btn primary', href: '#/' }, 'New game'))]);
    tick();
  }
  const place = (d) => {
    if (status !== 'playing' || sel < 0 || given[sel] !== '.') return;
    if (noteMode && d !== '.') { if (board[sel] !== '.') return; const n = notes.get(sel) || new Set(); n.has(d) ? n.delete(d) : n.add(d); notes.set(sel, n); draw(); return; }
    if (board[sel] === d) return; undo.push(board); board = board.slice(0, sel) + d + board.slice(sel + 1); notes.delete(sel); wrong = new Set();
    if (d !== '.') for (const j of peers(sel)) notes.get(j)?.delete(d);   // placing a digit removes it from peer notes
    draw(); save();
  };
  const doUndo = () => { if (!undo.length || status !== 'playing') return; board = undo.pop(); wrong = new Set(); draw(); save(); };
  const check = async () => { const r = await api('POST', '/check', { id, board }); wrong = new Set(r.wrong); draw(); toast(r.solved ? 'Solved!' : r.wrong.length ? `${r.wrong.length} wrong digit${r.wrong.length > 1 ? 's' : ''} marked` : r.conflicts.length ? 'Conflicts shown in red' : 'No mistakes so far'); };
  const hint = async () => { if (status !== 'playing') return; try { const r = await api('POST', '/hint', { id, board }); undo.push(board); board = board.slice(0, r.index) + r.digit + board.slice(r.index + 1); sel = r.index; hints++; wrong = new Set(); draw(); save(); } catch (e) { toast(e.message); } };
  const pad = h('div', { class: 'pad' }, [...'123456789'].map((d) => h('button', { 'data-pad': d, onclick: () => place(d) }, d)));
  render(h('h1', null, `${g.difficulty[0].toUpperCase() + g.difficulty.slice(1)} puzzle`), timerEl, grid, pad, h('div', { class: 'tools' }, noteBtn, h('button', { id: 'erase', onclick: () => place('.') }, 'Erase'), h('button', { id: 'undo', onclick: doUndo }, 'Undo'), h('button', { id: 'check', onclick: check }, 'Check'), h('button', { id: 'hint', onclick: hint }, 'Hint')), banner);
  keyHandler = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key;
    if (/^[1-9]$/.test(k)) place(k); else if (k === 'Backspace' || k === 'Delete' || k === '0') place('.'); else if (k === 'n' || k === 'N') noteBtn.click();
    else if (k.startsWith('Arrow')) { e.preventDefault(); if (sel < 0) sel = 40; else { const r = Math.floor(sel / 9), c = sel % 9; sel = k === 'ArrowUp' ? Math.max(0, r - 1) * 9 + c : k === 'ArrowDown' ? Math.min(8, r + 1) * 9 + c : k === 'ArrowLeft' ? r * 9 + Math.max(0, c - 1) : r * 9 + Math.min(8, c + 1); } draw(); grid.querySelector(`[data-i="${sel}"]`).focus(); }
    else return; if (/^[0-9]$|Backspace|Delete/.test(k)) e.preventDefault();
  };
  timerHandle = setInterval(() => { tick(); }, 1000); draw(); if (status === 'playing' && board === given) tick();
  const autosave = setInterval(() => { if (status === 'playing' && location.hash.includes(id)) save(); }, 15000); const stop = timerHandle; timerHandle = { stop: () => { clearInterval(stop); clearInterval(autosave); } };
}

async function statsView() {
  const s = await api('GET', '/stats');
  render(h('h1', null, 'Statistics'), h('div', { class: 'statgrid', id: 'stats' }, Object.entries(s).map(([d, v]) => h('div', { class: 'card', 'data-diff': d }, h('strong', null, d[0].toUpperCase() + d.slice(1)), h('div', null, `Solved: ${v.solved}`), h('div', null, `Best (no hints): ${fmt(v.bestClean)}`), h('div', { class: 'meta' }, `Best overall: ${fmt(v.bestAny)}`), h('div', { class: 'meta' }, `In progress: ${v.inProgress}`)))), h('p', null, h('a', { class: 'btn', href: '#/' }, 'New game')));
}
let routing = Promise.resolve();
async function doRoute() {
  const parts = location.hash.slice(1).split('?')[0].split('/').filter(Boolean); if (timerHandle) { (timerHandle.stop || (() => clearInterval(timerHandle)))(); timerHandle = null; } keyHandler = null;
  document.getElementById('nav-new').removeAttribute('aria-current'); document.getElementById('nav-stats').removeAttribute('aria-current');
  try {
    if (!parts.length) { document.getElementById('nav-new').setAttribute('aria-current', 'page'); await startView(); }
    else if (parts[0] === 'play' && parts[1]) await playView(parts[1]);
    else if (parts[0] === 'stats') { document.getElementById('nav-stats').setAttribute('aria-current', 'page'); await statsView(); }
    else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back'));
  } catch (e) { render(h('h1', null, e.status === 404 ? 'Game not found' : 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('keydown', (e) => keyHandler && keyHandler(e)); addEventListener('hashchange', route); route();
