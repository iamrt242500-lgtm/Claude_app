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
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { const t = h('textarea', { 'aria-hidden': 'true' }, text); document.body.append(t); t.select(); try { document.execCommand('copy') ? toast('Link copied') : toast('Copy failed — select the link manually', 'error'); } finally { t.remove(); } } }
const pubUrl = (slug) => `${location.origin}/#/p/${slug}`, admUrl = (tok) => `${location.origin}/#/a/${tok}`;
const field = (label, ctl, err) => h('label', { class: 'f' }, label, ctl, err && h('span', { class: 'err', role: 'alert' }, err));
const MODE = { always: 'Always show results', after_vote: 'Show results after someone votes', after_close: 'Show results only when the poll closes' };
const linkBox = (label, url, id) => h('div', {}, h('div', { class: 'small muted' }, label), h('div', { class: 'linkbox' }, h('input', { type: 'text', readonly: true, value: url, id, 'aria-label': label, onfocus: (e) => e.target.select() }), h('button', { class: 'btn sm', onclick: () => copy(url) }, 'Copy')));

/* ---------- create ---------- */
function viewCreate() {
  const st = { question: '', options: ['', ''], multi: false, resultsMode: 'always', closesAt: '' }; let errs = {};
  const root = h('div');
  const err = (k) => errs[k] && h('span', { class: 'err', role: 'alert' }, errs[k]);
  const draw = () => root.replaceChildren(h('form', { novalidate: true, onsubmit: async (e) => { e.preventDefault(); $('#create').disabled = true;
    try { const body = { question: st.question, options: st.options, multi: st.multi, resultsMode: st.resultsMode, closesAt: st.closesAt ? new Date(st.closesAt).toISOString() : null }; const p = await api('/polls', { method: 'POST', body }); showCreated(p); }
    catch (x) { errs = x.details || { question: x.message }; draw(); $('.err')?.scrollIntoView({ block: 'center' }); } } },
    field('Question', h('input', { type: 'text', id: 'question', value: st.question, maxlength: 200, placeholder: 'What should we have for lunch?', oninput: (e) => { st.question = e.target.value; } }), errs.question),
    h('div', {}, h('div', { class: 'small' }, h('strong', {}, 'Options')), st.options.map((o, i) => h('div', { class: 'opt' }, h('input', { type: 'text', class: 'optin', value: o, maxlength: 100, placeholder: `Option ${i + 1}`, 'aria-label': `Option ${i + 1}`, oninput: (e) => { st.options[i] = e.target.value; } }), h('button', { type: 'button', class: 'btn sm', 'aria-label': `Remove option ${i + 1}`, disabled: st.options.length <= 2, onclick: () => { st.options.splice(i, 1); draw(); } }, '✕'))),
      st.options.length < 10 ? h('button', { type: 'button', class: 'btn sm', id: 'add-opt', onclick: () => { st.options.push(''); draw(); $$('.optin').at(-1)?.focus(); } }, '+ Add option') : null, err('options')),
    h('label', { class: 'row' }, h('input', { type: 'checkbox', id: 'multi', checked: st.multi, onchange: (e) => { st.multi = e.target.checked; } }), ' Allow choosing several options'),
    field('Results visibility', h('select', { id: 'mode', onchange: (e) => { st.resultsMode = e.target.value; } }, Object.entries(MODE).map(([k, l]) => h('option', { value: k, selected: st.resultsMode === k }, l))), errs.resultsMode),
    field('Close automatically (optional)', h('input', { type: 'datetime-local', id: 'closes', value: st.closesAt, onchange: (e) => { st.closesAt = e.target.value; } }), errs.closesAt), h('div', {}, h('button', { class: 'btn primary', id: 'create' }, 'Create poll'))));
  const $$ = (s) => [...document.querySelectorAll(s)];
  render(h('h1', {}, 'Create a poll'), h('div', { class: 'card' }, root)); draw();
}
function showCreated(p) {
  render(h('h1', {}, 'Your poll is ready 🎉'), h('div', { class: 'card', id: 'created' }, h('p', {}, h('strong', {}, p.question)), linkBox('Share this link with voters', pubUrl(p.slug), 'public-link'),
    h('div', { class: 'warn' }, h('strong', {}, 'Save your admin link now. '), 'It lets you see full results, close or delete the poll — and it is shown only once. We store only a hash, so it cannot be recovered.'), linkBox('Admin link (keep private)', admUrl(p.adminToken), 'admin-link'),
    h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/p/${p.slug}`, id: 'open-poll' }, 'Open poll'), h('a', { class: 'btn', href: `#/a/${p.adminToken}`, id: 'open-admin' }, 'Open admin page'))));
}

/* ---------- poll (voter) ---------- */
function results(p, adm) {
  if (!p.resultsVisible) return h('p', { class: 'muted', id: 'results-hidden' }, p.resultsMode === 'after_close' ? 'Results will be visible when the poll closes.' : 'Vote to see the results.');
  return h('div', { id: 'results' }, p.options.map((o) => h('div', { class: 'res' + (p.myVote.includes(o.id) ? ' mine' : ''), 'data-opt': o.text }, h('div', { class: 'top2' }, h('strong', {}, o.text), h('span', { class: 'num' }, `${o.votes} · ${o.percent}%`)), h('progress', { max: 100, value: o.percent, 'aria-label': `${o.text}: ${o.percent}%` }))),
    h('p', { class: 'small muted', id: 'total' }, `${p.totalVotes} vote${p.totalVotes === 1 ? '' : 's'}${adm ? ` from ${adm.voters} voter${adm.voters === 1 ? '' : 's'}` : ''}`));
}
const status = (p) => h('span', { class: 'badge ' + (p.closed ? 'closed' : 'open') }, p.closed ? 'closed' : 'open');
async function viewPoll(slug) {
  let p = await api('/polls/' + slug), sel = [...p.myVote];
  const draw = () => {
    const form = p.closed ? h('p', { class: 'muted' }, 'This poll is closed — voting has ended.') : h('form', { novalidate: true, onsubmit: async (e) => { e.preventDefault(); $('#vote').disabled = true; try { p = await api(`/polls/${slug}/vote`, { method: 'POST', body: { options: sel } }); sel = [...p.myVote]; toast('Vote recorded'); draw(); } catch (x) { toast(x.details?.options || x.message, 'error'); if (x.status === 409) p = await api('/polls/' + slug).catch(() => p); draw(); } } },
      h('div', { role: p.multi ? 'group' : 'radiogroup', 'aria-labelledby': 'q' }, p.options.map((o) => h('label', { class: 'choice' }, h('input', { type: p.multi ? 'checkbox' : 'radio', name: 'opt', value: o.id, checked: sel.includes(o.id), onchange: (e) => { sel = p.multi ? (e.target.checked ? [...sel, o.id] : sel.filter((x) => x !== o.id)) : [o.id]; } }), h('span', {}, o.text)))),
      p.multi ? h('p', { class: 'small muted' }, 'Choose as many as you like.') : null, h('button', { class: 'btn primary', id: 'vote' }, p.hasVoted ? 'Change my vote' : 'Vote'));
    render(h('div', { class: 'card' }, h('h1', { id: 'q' }, p.question, status(p)), p.closesAt && !p.closed ? h('p', { class: 'small muted' }, `Closes ${new Date(p.closesAt).toLocaleString()}`) : null, form), h('div', { class: 'card' }, h('h2', {}, 'Results'), results(p)), h('p', {}, h('a', { href: '#/', class: 'small muted' }, 'Create your own poll')));
  };
  draw();
}

/* ---------- admin ---------- */
async function viewAdmin(token) {
  let p = await api('/admin/' + token);
  const act = async (path, body, msg) => { try { p = await api(`/admin/${token}${path}`, { method: 'POST', body }); toast(msg); draw(); } catch (x) { toast(x.details ? Object.values(x.details)[0] : x.message, 'error'); } };
  const draw = () => {
    const dlg = h('dialog', { 'aria-labelledby': 'dt' }, h('h2', { id: 'dt' }, 'Delete this poll and all its votes?'), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-del', onclick: async () => { try { await api('/admin/' + token, { method: 'DELETE' }); toast('Poll deleted'); location.hash = '#/'; } catch (x) { dlg.close(); toast(x.message, 'error'); } } }, 'Delete'), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
    render(h('div', { class: 'card' }, h('h1', {}, p.question, status(p)), h('p', { class: 'small muted' }, `${MODE[p.resultsMode]} · ${p.multi ? 'multiple choice' : 'single choice'}${p.closesAt ? ` · ${p.manuallyClosed ? 'closed manually' : 'closes ' + new Date(p.closesAt).toLocaleString()}` : ''}`), linkBox('Voter link', pubUrl(p.slug), 'public-link'),
      h('div', { class: 'row' }, p.closed ? h('button', { class: 'btn', id: 'reopen', onclick: () => act('/reopen', undefined, 'Poll reopened') }, 'Reopen') : h('button', { class: 'btn', id: 'close', onclick: () => act('/close', undefined, 'Poll closed') }, 'Close poll'),
        h('button', { class: 'btn danger', id: 'del', onclick: () => dlg.showModal() }, 'Delete poll'), h('a', { class: 'btn', href: `#/p/${p.slug}` }, 'View as voter'))), h('div', { class: 'card' }, h('h2', {}, 'Results (admin view)'), results({ ...p, resultsVisible: true, myVote: [] }, p)), dlg);
  };
  draw();
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const hash = location.hash.slice(1) || '/'; let m;
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') viewCreate(); else if ((m = hash.match(/^\/p\/([A-Za-z0-9_-]+)$/))) await viewPoll(m[1]); else if ((m = hash.match(/^\/a\/([A-Za-z0-9_-]+)$/))) await viewAdmin(m[1]);
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Create a poll')));
  } catch (e) {
    if (e.status === 404) render(h('div', { class: 'card empty' }, h('h2', {}, 'Poll not found'), h('p', { class: 'muted' }, 'The link may be wrong, or the poll was deleted.'), h('a', { class: 'btn', href: '#/' }, 'Create a poll')));
    else render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
