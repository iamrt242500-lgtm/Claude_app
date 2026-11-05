const app = document.getElementById('app');
const h = (tag, props, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } add(e, kids); return e; };
const add = (e, kids) => { for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); };
const render = (...kids) => { app.replaceChildren(); add(app, kids); };
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j?.error || 'Request failed'); e.details = j?.details; throw e; } return j;
}
const errText = (e) => (e.details ? Object.values(e.details).join(' · ') : e.message);

function calcView(sp) {
  const f = (id, label, ph, v) => [h('label', { for: id }, label), h('input', { id, placeholder: ph, value: v || '', autocomplete: 'off', spellcheck: 'false' })];
  const dist = f('distance', 'Distance', '10k, 6.2 mi, half', sp.get('distance')), time = f('time', 'Time', '50:00 or 1h30m', sp.get('time')), pace = f('pace', 'Pace', '5:00', sp.get('pace'));
  const unit = h('select', { id: 'unit', 'aria-label': 'Pace unit' }, ['km', 'mi'].map((u) => h('option', { value: u, selected: sp.get('unit') === u }, 'per ' + u))), neg = h('input', { id: 'negative', type: 'number', min: 0, max: 10, step: 0.5, value: sp.get('negative') || 0, 'aria-label': 'Negative split percent' });
  const out = h('div', { id: 'result' }); let seq = 0;
  const val = (a) => a[1].value.trim();
  const run = async () => {
    const mine = ++seq, body = { distance: val(dist), time: val(time), pace: val(pace), unit: unit.value, negative: neg.value }; out.replaceChildren();
    const filled = [body.distance, body.time, body.pace].filter(Boolean).length;
    if (filled < 2) { add(out, [h('p', { class: 'empty', id: 'hint' }, 'Fill in any two of distance, time and pace — the third is calculated.')]); return; }
    try {
      const r = await api('POST', '/calc', body); if (mine !== seq) return;   // a newer keystroke already started another request
      const q = new URLSearchParams(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '' && v != null))); history.replaceState(null, '', '#/?' + q);
      out.replaceChildren(); add(out, [h('p', { class: 'big', id: 'summary' }, `${r.timeText} for ${r.distance >= 1000 ? (r.distance / 1000).toFixed(2).replace(/\.?0+$/, '') + ' km' : r.distance + ' m'}`), h('p', { class: 'meta', id: 'pace-line' }, `Pace ${r.paceText} /${r.unit} · ${r.speedKmh} km/h`),
        h('h2', null, 'Splits'), h('div', { class: 'scroll' }, h('table', { class: 't', id: 'splits' }, h('thead', null, h('tr', null, ['#', 'Dist (m)', 'Split', 'Pace', 'Total'].map((x) => h('th', null, x)))), h('tbody', null, r.splits.map((s) => h('tr', null, [s.n, s.dist, s.split, s.pace, s.cumulative].map((x) => h('td', null, x))))))),
        h('h2', null, 'Race predictions (Riegel)'), h('div', { class: 'scroll' }, h('table', { class: 't', id: 'predictions' }, h('thead', null, h('tr', null, ['Race', 'Time', `Pace /${r.unit}`].map((x) => h('th', null, x)))), h('tbody', null, r.predictions.map((p) => h('tr', { 'data-race': p.name }, [p.name, p.time, p.pace].map((x) => h('td', null, x))))))),
        h('p', null, h('a', { class: 'btn', id: 'save-goal', href: `#/goals?distance=${encodeURIComponent(body.distance || r.distance + 'm')}&time=${encodeURIComponent(r.timeText)}` }, 'Save as goal'))]);
    } catch (e) { if (mine === seq) add(out, [h('p', { class: 'err', id: 'calc-error', role: 'alert' }, errText(e))]); }
  };
  render(h('h1', null, 'Pace calculator'), h('div', { class: 'fields' }, h('div', null, dist), h('div', null, time), h('div', null, pace, h('div', null, unit)), h('div', null, h('label', { for: 'negative' }, 'Negative split %'), neg)), out);
  for (const el of [dist[1], time[1], pace[1], unit, neg]) el.addEventListener('input', run); run();
}

async function goalsView(sp) {
  const goals = await api('GET', '/goals'), name = h('input', { id: 'gname', maxlength: 80 }), d = h('input', { id: 'gdist', value: sp.get('distance') || '', placeholder: '10k' }), t = h('input', { id: 'gtime', value: sp.get('time') || '', placeholder: '48:00' }), date = h('input', { id: 'gdate', type: 'date' }), err = h('p', { class: 'err', id: 'form-error', role: 'alert' });
  const save = async (e) => { e.preventDefault(); err.textContent = ''; try { await api('POST', '/goals', { name: name.value, distance: d.value, time: t.value, raceDate: date.value }); location.hash = '#/goals'; await route(); } catch (er) { err.textContent = errText(er); } };
  render(h('h1', null, 'Goals'), h('form', { class: 'card', onsubmit: save }, h('div', { class: 'fields' }, h('div', null, h('label', { for: 'gname' }, 'Name'), name), h('div', null, h('label', { for: 'gdist' }, 'Distance'), d), h('div', null, h('label', { for: 'gtime' }, 'Goal time'), t), h('div', null, h('label', { for: 'gdate' }, 'Race date'), date)), err, h('p', null, h('button', { class: 'primary' }, 'Save goal'))),
    goals.length ? goals.map((g) => h('div', { class: 'card', 'data-goal': g.id }, h('strong', null, g.name), h('div', { class: 'meta' }, h('span', null, `${g.timeText} · ${g.distance >= 1000 ? +(g.distance / 1000).toFixed(2) + ' km' : g.distance + ' m'}`), h('span', null, `${g.paceText}/km · ${g.paceMi}/mi`), h('span', null, g.raceDate || 'no date')),
      h('p', null, h('a', { href: `#/?distance=${encodeURIComponent(g.distance + 'm')}&time=${encodeURIComponent(g.timeText)}` }, 'Open in calculator'), ' ', h('button', { class: 'danger', 'aria-label': `Delete ${g.name}`, onclick: async () => { if (!confirm('Delete this goal?')) return; await api('DELETE', `/goals/${g.id}`); await route(); } }, 'Delete')))) : h('p', { class: 'empty' }, 'No goals yet.'));
}

let routing = Promise.resolve();
async function doRoute() {
  const [path, qs] = location.hash.slice(1).split('?'), parts = path.split('/').filter(Boolean), sp = new URLSearchParams(qs || '');
  document.getElementById('nav-calc').removeAttribute('aria-current'); document.getElementById('nav-goals').removeAttribute('aria-current');
  try {
    if (!parts.length) { document.getElementById('nav-calc').setAttribute('aria-current', 'page'); calcView(sp); }
    else if (parts[0] === 'goals') { document.getElementById('nav-goals').setAttribute('aria-current', 'page'); await goalsView(sp); }
    else render(h('h1', null, 'Not found'), h('a', { href: '#/' }, 'Back'));
  } catch (e) { render(h('h1', null, 'Something went wrong'), h('p', { class: 'err' }, e.message), h('a', { href: '#/' }, 'Back')); }
}
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
addEventListener('hashchange', route); route();
