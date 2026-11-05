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
async function api(path, opts = {}) {
  let res;
  try { res = await fetch('/api' + path, { method: opts.method, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new ApiError('Network error — check your connection and try again.', null, 0); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, data.details, res.status);
  return data;
}
const field = (label, ctl, err) => h('label', { class: 'f' }, label, ctl, err && h('span', { class: 'err', role: 'alert' }, err));
const confirmDialog = (title, onOk) => { const d = h('dialog', { 'aria-labelledby': 'cdt' }, h('h2', { id: 'cdt' }, title), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-ok', onclick: async () => { d.close(); await onOk(); } }, 'Delete'), h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'))); d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
const dayLabel = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
let week = mondayOf(localToday()), system = 'metric';

/* ---------- recipes ---------- */
async function viewRecipes() {
  let q = ''; const out = h('div');
  const load = async () => { const list = await api('/recipes' + (q ? '?q=' + encodeURIComponent(q) : '')); out.replaceChildren(list.length ? h('div', { class: 'card' }, h('ul', { class: 'list', id: 'recipes' }, list.map((r) => h('li', { class: 'item', 'data-recipe': r.title }, h('div', {}, h('a', { href: '#/r/' + r.id }, h('strong', {}, r.title)), h('div', { class: 'small muted' }, `${r.servings} servings · ${r.ingredientCount} ingredients`)), h('a', { class: 'btn sm', href: `#/r/${r.id}/edit`, 'aria-label': 'Edit ' + r.title }, 'Edit'))))) : h('div', { class: 'card empty' }, q ? 'No recipes match.' : h('div', {}, h('h2', {}, 'No recipes yet'), h('p', {}, 'Add a recipe, plan your week, and get one combined shopping list.'), h('a', { class: 'btn primary', href: '#/new' }, 'Add your first recipe')))); };
  render(h('h1', {}, 'Recipes'), h('input', { type: 'search', id: 'search', 'aria-label': 'Search recipes', placeholder: 'Search by title or ingredient…', oninput: (e) => { q = e.target.value; clearTimeout(viewRecipes.t); viewRecipes.t = setTimeout(() => load().catch((x) => toast(x.message, 'error')), 200); } }), h('p'), out); await load();
}
async function viewEditor(id) {
  const ex = id ? await api('/recipes/' + id) : null; let errs = {};
  const v = ex ? { title: ex.title, servings: ex.servings, ingredients: ex.ingredients.join('\n'), steps: ex.steps } : { title: '', servings: 4, ingredients: '', steps: '' };
  const draw = (vals) => render(h('h1', {}, ex ? 'Edit recipe' : 'New recipe'), h('div', { class: 'card' }, h('form', { novalidate: true, onsubmit: async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); $('#save').disabled = true;
    try { const r = await api(ex ? '/recipes/' + id : '/recipes', { method: ex ? 'PUT' : 'POST', body: { ...fd, servings: Number(fd.servings) } }); toast('Recipe saved'); location.hash = '#/r/' + r.id; } catch (x) { errs = x.details || { title: x.message }; draw(fd); } } },
    h('div', { class: 'two' }, field('Title', h('input', { type: 'text', name: 'title', id: 'title', value: vals.title, maxlength: 100 }), errs.title), field('Servings', h('input', { type: 'number', name: 'servings', id: 'servings', value: vals.servings, min: 1, max: 100 }), errs.servings)),
    field('Ingredients (one per line, e.g. "1 1/2 cups flour")', h('textarea', { name: 'ingredients', id: 'ingredients', spellcheck: 'false' }, vals.ingredients), errs.ingredients), field('Steps', h('textarea', { name: 'steps', id: 'steps' }, vals.steps), errs.steps),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'save' }, ex ? 'Save changes' : 'Save recipe'), h('a', { class: 'btn', href: ex ? '#/r/' + id : '#/' }, 'Cancel')))));
  draw(v);
}
async function viewRecipe(id) {
  let servings = null, sys = 'original'; const body = h('div');
  let seq = 0, lastRecipe = null;
  // The local `servings` is the source of truth; responses only supply the rendered text. Stale responses (older clicks) are dropped.
  const load = async () => {
    const my = ++seq; if (servings != null && lastRecipe) draw(lastRecipe);   // update the stepper immediately
    const r = await api(`/recipes/${id}?system=${sys}${servings ? '&servings=' + servings : ''}`); if (my !== seq) return;
    if (servings == null) servings = r.view.servings; lastRecipe = r; draw(r);
  };
  const draw = (r) => {
    const dlg = () => confirmDialog(`Delete "${r.title}"? It will also be removed from your meal plan.`, async () => { try { await api('/recipes/' + id, { method: 'DELETE' }); toast('Recipe deleted'); location.hash = '#/'; } catch (x) { toast(x.message, 'error'); } });
    const step = (d) => h('button', { class: 'btn sm', 'aria-label': d < 0 ? 'Fewer servings' : 'More servings', disabled: servings + d < 1 || servings + d > 500, onclick: () => { servings += d; load().catch((x) => toast(x.message, 'error')); } }, d < 0 ? '−' : '+');
    body.replaceChildren(h('div', { class: 'row between' }, h('h1', {}, r.title), h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/r/${id}/edit`, id: 'edit' }, 'Edit'), h('button', { class: 'btn danger', id: 'del', onclick: dlg }, 'Delete'))),
      h('div', { class: 'card' }, h('div', { class: 'row between' }, h('div', { class: 'stepper' }, 'Servings ', step(-1), h('output', { id: 'servings-out' }, String(servings)), step(1), r.view.factor !== 1 ? h('span', { class: 'small muted' }, `(recipe makes ${r.servings})`) : null),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Units' }, [['original', 'As written'], ['metric', 'Metric'], ['us', 'US']].map(([k, l]) => h('button', { 'data-sys': k, 'aria-pressed': String(sys === k), onclick: () => { sys = k; load().catch((x) => toast(x.message, 'error')); } }, l)))),
        h('h2', {}, 'Ingredients'), h('ul', { class: 'ing', id: 'ingredients-list' }, r.view.ingredients.map((i) => h('li', { class: i.scaled && (r.view.factor !== 1 || sys !== 'original') ? 'changed' : '' }, i.scaled ? [h('strong', {}, i.qtyText), ' ', i.name] : i.text)))),
      r.steps ? h('div', { class: 'card' }, h('h2', {}, 'Steps'), h('p', { class: 'pre' }, r.steps)) : null,
      h('div', { class: 'card' }, h('h2', {}, 'Add to meal plan'), h('form', { class: 'row', novalidate: true, onsubmit: async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { await api('/plan', { method: 'POST', body: { day: fd.day, meal: fd.meal, recipeId: Number(id), servings } }); toast(`Planned for ${dayLabel(fd.day)}`); } catch (x) { $('#plan-err').textContent = x.details ? Object.values(x.details).join(' · ') : x.message; } } },
        h('input', { type: 'date', name: 'day', id: 'plan-day', value: localToday(), 'aria-label': 'Day' }), h('select', { name: 'meal', id: 'plan-meal', 'aria-label': 'Meal' }, ['breakfast', 'lunch', 'dinner', 'snack'].map((m) => h('option', { value: m, selected: m === 'dinner' }, m[0].toUpperCase() + m.slice(1)))), h('button', { class: 'btn primary', id: 'plan-add' }, `Add (${servings} servings)`), h('span', { class: 'err', id: 'plan-err', role: 'alert' }))));
  };
  render(body); await load();
}

/* ---------- plan ---------- */
const weekNav = (onChange) => h('div', { class: 'row' }, h('button', { class: 'btn sm', id: 'prev-week', 'aria-label': 'Previous week', onclick: () => { week = addDays(week, -7); onChange(); } }, '‹'), h('strong', { id: 'week-label' }, `${dayLabel(week)} – ${dayLabel(addDays(week, 6))}`), h('button', { class: 'btn sm', id: 'next-week', 'aria-label': 'Next week', onclick: () => { week = addDays(week, 7); onChange(); } }, '›'));
async function viewPlan() {
  const [pl, recipes] = await Promise.all([api('/plan?week=' + week), api('/recipes')]);
  const mealOptions = () => ['breakfast', 'lunch', 'dinner', 'snack'].map((m) => h('option', { value: m, selected: m === 'dinner' }, m[0].toUpperCase() + m.slice(1)));
  const entry = (e, d) => h('div', { class: 'entry', 'data-entry': e.title },
    h('div', { class: 'meal' }, e.meal), h('a', { href: '#/r/' + e.recipeId }, e.title), h('span', { class: 'small muted' }, ` · ${e.servings} serv. `),
    h('button', { class: 'btn sm', 'aria-label': `Remove ${e.title} from ${dayLabel(d)}`, onclick: async () => { try { await api('/plan/' + e.id, { method: 'DELETE' }); toast('Removed'); route(); } catch (x) { toast(x.message, 'error'); } } }, '✕'));
  const addForm = (d) => h('form', { class: 'row', novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault(); const fd = Object.fromEntries(new FormData(ev.target)); if (!fd.recipeId) return;
    try { await api('/plan', { method: 'POST', body: { day: d, meal: fd.meal, recipeId: Number(fd.recipeId) } }); toast('Added'); route(); } catch (x) { toast(x.details ? Object.values(x.details)[0] : x.message, 'error'); } } },
    h('select', { name: 'recipeId', 'aria-label': 'Recipe for ' + dayLabel(d) }, h('option', { value: '' }, '+ Add…'), recipes.map((r) => h('option', { value: r.id }, r.title))),
    h('select', { name: 'meal', 'aria-label': 'Meal for ' + dayLabel(d) }, mealOptions()), h('button', { class: 'btn sm' }, 'Add'));
  const day = (d) => {
    const entries = pl.entries.filter((e) => e.day === d);
    return h('section', { class: 'day', 'data-day': d }, h('h3', {}, dayLabel(d)), entries.map((e) => entry(e, d)), entries.length ? null : h('div', { class: 'small muted' }, 'Nothing planned'), recipes.length ? addForm(d) : null);
  };
  render(h('div', { class: 'row between' }, h('h1', {}, 'Meal plan'), weekNav(route)), h('div', { class: 'week', id: 'week' }, pl.days.map(day)),
    h('p', {}, h('a', { class: 'btn', href: '#/shopping' }, 'Shopping list for this week →')));
}

/* ---------- shopping ---------- */
async function viewShopping() {
  const s = await api(`/shopping?week=${week}&system=${system}`);
  const done = s.items.filter((i) => i.checked).length;
  render(h('div', { class: 'row between' }, h('h1', {}, 'Shopping list'), weekNav(route)), h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', { class: 'muted', id: 'progress' }, s.items.length ? `${done} of ${s.items.length} ticked off` : ''), h('div', { class: 'seg', role: 'group', 'aria-label': 'Units' }, [['metric', 'Metric'], ['us', 'US']].map(([k, l]) => h('button', { 'data-sys': k, 'aria-pressed': String(system === k), onclick: () => { system = k; route(); } }, l)))),
    s.items.length ? h('ul', { class: 'list shop', id: 'shop' }, s.items.map((i) => h('li', { class: i.checked ? 'done' : '', 'data-item': i.name }, h('input', { type: 'checkbox', checked: i.checked, id: 'chk-' + i.key.replace(/\W/g, '_'), 'aria-label': `${i.qtyText} ${i.name}`.trim(), onchange: async (e) => { try { await api(`/shopping/check?week=${week}&system=${system}`, { method: 'POST', body: { item: i.key, checked: e.target.checked } }); route(); } catch (x) { toast(x.message, 'error'); e.target.checked = !e.target.checked; } } }), h('span', { class: 'q' }, i.qtyText || '—'), h('span', {}, i.name), i.sources > 1 ? h('span', { class: 'small muted' }, `(${i.sources} recipes/lines)`) : null))) : h('p', { class: 'empty' }, 'Nothing planned this week. Add recipes in the meal plan to build your list.')),
    h('p', { class: 'small muted' }, 'Quantities with the same ingredient and dimension (volume, weight, count) are added together. Volume and weight of the same ingredient stay separate — converting needs a density.'));
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const hash = location.hash.slice(1) || '/'; let m;
  document.querySelectorAll('nav a').forEach((a) => { const on = a.dataset.nav === (hash === '/plan' ? 'plan' : hash === '/shopping' ? 'shopping' : 'recipes'); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewRecipes(); else if (hash === '/new') await viewEditor(null); else if ((m = hash.match(/^\/r\/(\d+)\/edit$/))) await viewEditor(m[1]); else if ((m = hash.match(/^\/r\/(\d+)$/))) await viewRecipe(m[1]); else if (hash === '/plan') await viewPlan(); else if (hash === '/shopping') await viewShopping();
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) render(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to recipes')));
    else render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
