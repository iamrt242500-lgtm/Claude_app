const app = document.getElementById('app'), NS = 'http://www.w3.org/2000/svg';
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const sv = (tag, props) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(props || {})) e.setAttribute(k, v); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3000); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function api(method, path, body) {
  const r = await fetch('/api' + path + (path.includes('?') ? '&' : '?') + 'today=' + localToday(), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.status = r.status; e.details = j?.details; throw e; } return j;
}
const errText = (e) => (e.details ? Object.values(e.details).join(' · ') : e.message), fmt = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const progress = (b) => { const bar = h('div', { class: 'bar' + (b.status === 'finished' ? ' done' : ''), role: 'progressbar', 'aria-valuenow': b.percent, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { 'data-w': b.percent })); return bar; };
const applyWidths = () => document.querySelectorAll('[data-w]').forEach((el) => { el.style.width = el.dataset.w + '%'; });
const etaText = (b) => (b.status === 'finished' ? `Finished ${fmt(b.finishedDay)}` : b.eta ? `≈ ${b.eta.days} day${b.eta.days === 1 ? '' : 's'} left at ${b.pagesPerDay} pages/day → ${fmt(b.eta.date)}` : b.status === 'reading' ? 'No reading in the last 14 days — no estimate' : 'Not started');

async function shelfView(sp) {
  const filter = sp.get('f') || 'all', books = await api('GET', '/books'), shown = books.filter((b) => filter === 'all' || b.status === filter);
  const title = h('input', { id: 'title', maxlength: 120 }), author = h('input', { id: 'author', maxlength: 80 }), pages = h('input', { id: 'pages', type: 'number', min: 1, max: 20000, size: 6 }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
  render(h('h1', null, 'Shelf'), h('form', { class: 'card row', onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; try { const b = await api('POST', '/books', { title: title.value, author: author.value, totalPages: Number(pages.value) }); location.hash = `#/book/${b.id}`; } catch (e) { err.textContent = errText(e); } } }, h('div', null, h('label', { for: 'title' }, 'Title'), title), h('div', null, h('label', { for: 'author' }, 'Author'), author), h('div', null, h('label', { for: 'pages' }, 'Pages'), pages), h('button', { class: 'primary' }, 'Add book'), err),
    h('div', { class: 'tabs' }, [['all', 'All'], ['reading', 'Reading'], ['to-read', 'To read'], ['finished', 'Finished']].map(([k, l]) => h('a', { href: `#/?f=${k}`, 'aria-current': k === filter ? 'page' : null, 'data-filter': k }, l))),
    shown.length ? shown.map((b) => h('a', { class: 'card', href: `#/book/${b.id}`, 'data-book': b.title }, h('strong', null, b.title), b.author ? h('span', { class: 'meta' }, ` · ${b.author}`) : null, progress(b), h('div', { class: 'meta' }, `${b.page}/${b.totalPages} pages · ${b.percent}%`), h('div', { class: 'meta' }, etaText(b)))) : h('p', { class: 'empty' }, 'No books here yet.')); applyWidths();
}
async function bookView(id) {
  const load = async () => draw(await api('GET', `/books/${id}`));
  function draw(b) {
    const page = h('input', { id: 'page', type: 'number', min: 0, max: b.totalPages, value: b.page, 'aria-label': 'Current page' }), day = h('input', { id: 'day', type: 'date', value: localToday(), max: localToday(), 'aria-label': 'Date' }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
    const rating = h('select', { id: 'rating', 'aria-label': 'Rating', onchange: async () => { await api('PATCH', `/books/${id}`, { rating: rating.value ? Number(rating.value) : null }); toast('Saved'); } }, h('option', { value: '' }, 'No rating'), [1, 2, 3, 4, 5].map((n) => h('option', { value: n, selected: b.rating === n }, '★'.repeat(n))));
    render(h('h1', null, b.title), h('p', { class: 'meta' }, b.author || 'Unknown author'), progress(b), h('p', { id: 'status' }, `${b.page}/${b.totalPages} pages · ${b.percent}%`), h('p', { class: 'meta', id: 'eta' }, etaText(b)),
      h('form', { class: 'card row', onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; try { await api('PUT', `/books/${id}/log`, { day: day.value, page: Number(page.value) }); toast('Logged'); await load(); } catch (e) { err.textContent = errText(e); } } }, h('div', null, h('label', { for: 'page' }, 'I’m on page'), page), h('div', null, h('label', { for: 'day' }, 'on'), day), h('button', { class: 'primary', id: 'log' }, 'Log progress'), err),
      h('div', { class: 'row' }, h('label', { for: 'rating' }, 'Rating'), rating),
      h('h2', null, 'Reading log'), b.logs.length ? h('ul', { id: 'logs' }, b.logs.map((l) => h('li', { 'data-day': l.day }, `${fmt(l.day)} — page ${l.page} (${l.pages > 0 ? `+${l.pages}` : 'no new pages'}) `, h('button', { 'aria-label': `Delete log ${l.day}`, onclick: async () => { await api('DELETE', `/books/${id}/log/${l.day}`); await load(); } }, '✕')))) : h('p', { class: 'empty' }, 'Nothing logged yet.'),
      h('p', null, h('a', { href: '#/' }, '← Shelf'), ' ', h('button', { class: 'danger', id: 'delete', onclick: async () => { if (!confirm('Delete this book and its log?')) return; await api('DELETE', `/books/${id}`); location.hash = '#/'; } }, 'Delete'))); applyWidths();
  }
  await load();
}
async function statsView() {
  const s = await api('GET', '/stats'), max = Math.max(1, ...s.series.map((x) => x.pages)), W = 600, H = 150, bw = W / 30;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H + 18}`, class: 'chart', role: 'img', 'aria-label': `Pages read per day, last 30 days. Total ${s.pagesLast30}`, id: 'chart' });
  svg.append(sv('line', { x1: 0, x2: W, y1: H, y2: H, class: 'axis' })); s.series.forEach((p, i) => { const hh = (p.pages / max) * (H - 8); const r = sv('rect', { x: i * bw + 1, y: H - hh, width: bw - 2, height: hh, 'data-day': p.day, 'data-pages': p.pages }); svg.append(r); });
  const t1 = sv('text', { x: 0, y: H + 13 }); t1.textContent = s.series[0].day; const t2 = sv('text', { x: W, y: H + 13, 'text-anchor': 'end' }); t2.textContent = s.series[29].day; svg.append(t1, t2);
  const goal = h('input', { id: 'goal', type: 'number', min: 1, max: 1000, value: s.goal, 'aria-label': 'Yearly goal' }), gerr = h('p', { class: 'err', id: 'goal-error' });
  render(h('h1', null, 'Stats'), h('div', { class: 'statgrid', id: 'summary' }, [['Streak', `${s.streak} d`], ['Best streak', `${s.longestStreak} d`], ['Pages / day', s.rate14], ['Last 30 days', s.pagesLast30], ['Pages this year', s.yearPages]].map(([l, v]) => h('div', { class: 'card' }, h('b', null, v), l))), svg,
    h('h2', null, `${s.today.slice(0, 4)} reading goal`), h('p', { id: 'pace' }, `${s.finishedThisYear} of ${s.goal} books finished — ${s.pace.status}${s.pace.status === 'on track' ? '' : ` (${Math.abs(s.pace.diff)} book${Math.abs(s.pace.diff) === 1 ? '' : 's'} ${s.pace.status === 'ahead' ? 'ahead of' : 'behind'} the ${s.pace.expected} expected by today)`}.${s.pace.booksPerMonthNeeded ? ` About ${s.pace.booksPerMonthNeeded} books a month from here to make it.` : ''}`),
    h('form', { class: 'row', onsubmit: async (ev) => { ev.preventDefault(); gerr.textContent = ''; try { await api('PUT', '/goal', { goal: Number(goal.value) }); await route(); } catch (e) { gerr.textContent = errText(e); } } }, h('label', { for: 'goal' }, 'Books per year'), goal, h('button', { id: 'save-goal' }, 'Set goal'), gerr));
}
let routing = Promise.resolve();
async function doRoute() {
  const [path, qs] = location.hash.slice(1).split('?'), parts = path.split('/').filter(Boolean), sp = new URLSearchParams(qs || ''); document.getElementById('nav-shelf').removeAttribute('aria-current'); document.getElementById('nav-stats').removeAttribute('aria-current');
  try { if (!parts.length) { document.getElementById('nav-shelf').setAttribute('aria-current', 'page'); await shelfView(sp); } else if (parts[0] === 'book' && parts[1]) await bookView(Number(parts[1])); else if (parts[0] === 'stats') { document.getElementById('nav-stats').setAttribute('aria-current', 'page'); await statsView(); } else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back')); }
  catch (e) { render(h('h1', null, e.status === 404 ? 'Not found' : 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
