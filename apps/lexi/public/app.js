import { keyboard } from '/game.js';
const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 2500); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(method, path, body) {
  const r = await fetch('/api' + path + (path.includes('?') ? '&' : '?') + 'today=' + localToday(), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.details ? Object.values(j.details)[0] : j?.error || 'Request failed'); e.status = r.status; throw e; } return j;
}
const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], EMOJI = { g: '🟩', y: '🟨', x: '⬛' };
let onKey = null;

function playView(state) {
  let cur = '', busy = false, game = state; const board = h('div', { class: 'board', role: 'grid', 'aria-label': 'Guess board' }), kb = h('div', { class: 'kb' }), banner = h('div', { class: 'banner', id: 'banner' });
  const draw = () => {
    board.replaceChildren(); const done = game.status !== 'playing';
    for (let r = 0; r < game.maxGuesses; r++) {
      const row = game.rows[r], typing = r === game.rows.length && !done;
      board.append(h('div', { class: 'brow', role: 'row' }, [0, 1, 2, 3, 4].map((c) => { const letter = row ? row.guess[c] : typing ? cur[c] : ''; const t = h('div', { class: 'tile', role: 'gridcell', 'data-row': r, 'data-col': c, 'aria-label': row ? `${letter} ${{ g: 'correct', y: 'present', x: 'absent' }[row.result[c]]}` : letter || 'empty' }, letter || ''); if (letter) t.setAttribute('data-filled', ''); if (row) t.setAttribute('data-state', row.result[c]); return t; })));
    }
    const ks = keyboard(game.rows); kb.replaceChildren();
    KEYS.forEach((letters, i) => kb.append(h('div', { class: 'krow' }, i === 2 ? h('button', { class: 'key wide', 'data-key': 'enter', onclick: () => press('Enter') }, 'Enter') : null, [...letters].map((l) => h('button', { class: 'key', 'data-key': l, 'data-state': ks[l] || null, 'aria-label': l, onclick: () => press(l) }, l)), i === 2 ? h('button', { class: 'key wide', 'data-key': 'back', 'aria-label': 'Backspace', onclick: () => press('Backspace') }, '⌫') : null)));
    banner.replaceChildren(); if (done) add(banner, [h('p', { id: 'outcome' }, game.status === 'won' ? `Solved in ${game.rows.length}/${game.maxGuesses}!` : `The word was ${game.answer.toUpperCase()}.`), h('button', { class: 'primary', id: 'share', onclick: share }, 'Copy result'), ' ', h('a', { class: 'btn', href: '#/stats' }, 'Stats')]);
  };
  const share = async () => { const txt = `Lexi ${game.date} ${game.status === 'won' ? game.rows.length : 'X'}/${game.maxGuesses}\n` + game.rows.map((r) => [...r.result].map((c) => EMOJI[c]).join('')).join('\n'); try { await navigator.clipboard.writeText(txt); toast('Copied'); } catch { toast(txt); } };
  const press = async (k) => {
    if (busy || game.status !== 'playing') return;
    if (/^[a-zA-Z]$/.test(k)) { if (cur.length < 5) { cur += k.toLowerCase(); draw(); } }
    else if (k === 'Backspace') { cur = cur.slice(0, -1); draw(); }
    else if (k === 'Enter') {
      if (cur.length < 5) return toast('Not enough letters');
      busy = true; try { game = await api('POST', '/guess', { guess: cur }); cur = ''; } catch (e) { toast(e.message); if (e.status === 409) game = await api('GET', '/today'); } busy = false; draw();
    }
  };
  onKey = (e) => { if (e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === 'Enter' && e.target.closest?.('button,a')) return; press(e.key); };
  render(h('h1', null, 'Daily word'), h('p', { class: 'meta' }, `${game.date} · six tries`), board, banner, kb); draw();
}
async function statsView() {
  const s = await api('GET', '/stats'), max = Math.max(1, ...s.distribution);
  render(h('h1', null, 'Statistics'), h('div', { class: 'statgrid', id: 'stats' }, [['Played', s.played], ['Win %', s.winRate], ['Streak', s.currentStreak], ['Best', s.maxStreak]].map(([l, v]) => h('div', null, h('b', null, v), l))),
    h('h2', null, 'Guess distribution'), h('div', { class: 'bars' }, s.distribution.map((n, i) => h('div', { class: 'bar', 'data-bar': i + 1 }, h('span', null, i + 1), h('span', { class: 'fill', 'data-n': n }, n)))), h('p', null, h('a', { class: 'btn', href: '#/' }, 'Back to the game')));
  document.querySelectorAll('.fill').forEach((el) => { el.style.width = Math.max(8, (Number(el.dataset.n) / max) * 100) + '%'; });
}
let routing = Promise.resolve();
async function doRoute() {
  const parts = location.hash.slice(1).split('?')[0].split('/').filter(Boolean); onKey = null;
  document.getElementById('nav-play').removeAttribute('aria-current'); document.getElementById('nav-stats').removeAttribute('aria-current');
  try {
    if (!parts.length) { document.getElementById('nav-play').setAttribute('aria-current', 'page'); playView(await api('GET', '/today')); }
    else if (parts[0] === 'stats') { document.getElementById('nav-stats').setAttribute('aria-current', 'page'); await statsView(); }
    else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back'));
  } catch (e) { render(h('h1', null, 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('keydown', (e) => onKey && onKey(e)); addEventListener('hashchange', route); route();
