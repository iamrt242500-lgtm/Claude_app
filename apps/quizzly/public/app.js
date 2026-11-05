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
const confirmDialog = (title, onOk) => { const d = h('dialog', { 'aria-labelledby': 'cdt' }, h('h2', { id: 'cdt' }, title), h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'confirm-ok', onclick: async () => { d.close(); await onOk(); } }, 'Delete'), h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'))); d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); };
const LETTERS = 'ABCDEFGH';

/* ---------- list ---------- */
async function viewList() {
  const list = await api('/quizzes');
  render(h('h1', {}, 'Your quizzes'), list.length ? h('div', { class: 'card' }, h('ul', { class: 'list' }, list.map((z) => h('li', { class: 'item', 'data-quiz': z.title },
    h('div', {}, h('strong', {}, z.title), z.description ? h('div', { class: 'small muted' }, z.description) : null, h('div', { class: 'small muted' }, `${z.questions} question${z.questions === 1 ? '' : 's'} · ${z.attempts} attempt${z.attempts === 1 ? '' : 's'}${z.best != null ? ` · best ${z.best}% · last ${z.last}%` : ''}`)),
    h('div', { class: 'row' }, h('a', { class: 'btn primary sm', href: `#/play/${z.id}` }, 'Take quiz'), h('a', { class: 'btn sm', href: `#/q/${z.id}/history` }, 'History'), h('a', { class: 'btn sm', href: `#/q/${z.id}/edit`, 'aria-label': 'Edit ' + z.title }, 'Edit'),
      h('button', { class: 'btn sm danger', 'aria-label': 'Delete ' + z.title, onclick: () => confirmDialog(`Delete "${z.title}" and its history?`, async () => { try { await api('/quizzes/' + z.id, { method: 'DELETE' }); toast('Quiz deleted'); route(); } catch (x) { toast(x.message, 'error'); } }) }, 'Delete')))))) : h('div', { class: 'card empty' }, h('h2', {}, 'No quizzes yet'), h('p', {}, 'Create a quiz with single-choice, multiple-choice and short-answer questions.'), h('a', { class: 'btn primary', href: '#/new' }, 'Create your first quiz')));
}

/* ---------- editor ---------- */
const blank = (type = 'single') => ({ type, prompt: '', options: ['', ''], correct: [], answers: [''], explanation: '' });
async function viewEditor(id) {
  const existing = id ? await api('/quizzes/' + id) : null;
  const st = existing ? { title: existing.title, description: existing.description, questions: existing.questions.map((q) => ({ ...q, options: q.options.length ? [...q.options] : ['', ''], answers: q.answers.length ? [...q.answers] : [''] })) } : { title: '', description: '', questions: [blank()] };
  let errs = {}; const root = h('div');
  const err = (k) => errs[k] && h('span', { class: 'err', role: 'alert' }, errs[k]);
  const draw = () => {
    root.replaceChildren(h('div', { class: 'card' },
      h('label', { class: 'f' }, 'Title', h('input', { type: 'text', id: 'title', value: st.title, maxlength: 100, oninput: (e) => { st.title = e.target.value; } }), err('title')),
      h('label', { class: 'f' }, 'Description (optional)', h('input', { type: 'text', id: 'desc', value: st.description, maxlength: 500, oninput: (e) => { st.description = e.target.value; } }), err('description'))),
      ...st.questions.map((q, i) => h('fieldset', { class: 'qcard', 'data-q': i, style: null }, h('legend', {}, `Question ${i + 1}`),
        h('div', { class: 'row between' }, h('select', { 'aria-label': `Question ${i + 1} type`, class: 'qtype', onchange: (e) => { q.type = e.target.value; if (q.type === 'single') q.correct = q.correct.slice(0, 1); draw(); } }, [['single', 'Single choice'], ['multi', 'Multiple choice'], ['short', 'Short answer']].map(([k, l]) => h('option', { value: k, selected: q.type === k }, l))),
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm', 'aria-label': `Move question ${i + 1} up`, disabled: i === 0, onclick: () => { [st.questions[i - 1], st.questions[i]] = [st.questions[i], st.questions[i - 1]]; draw(); } }, '↑'), h('button', { type: 'button', class: 'btn sm', 'aria-label': `Move question ${i + 1} down`, disabled: i === st.questions.length - 1, onclick: () => { [st.questions[i + 1], st.questions[i]] = [st.questions[i], st.questions[i + 1]]; draw(); } }, '↓'),
            h('button', { type: 'button', class: 'btn sm danger', 'aria-label': `Remove question ${i + 1}`, disabled: st.questions.length === 1, onclick: () => { st.questions.splice(i, 1); draw(); } }, 'Remove'))),
        h('label', { class: 'f' }, 'Question', h('textarea', { class: 'qprompt', oninput: (e) => { q.prompt = e.target.value; } }, q.prompt), err(`questions.${i}.prompt`)),
        q.type === 'short' ? h('div', {}, h('div', { class: 'small muted' }, 'Accepted answers (case, accents and punctuation are ignored)'), q.answers.map((a, j) => h('div', { class: 'opt' }, h('input', { type: 'text', class: 'qans', value: a, 'aria-label': `Question ${i + 1} accepted answer ${j + 1}`, maxlength: 200, oninput: (e) => { q.answers[j] = e.target.value; } }), h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Remove answer', disabled: q.answers.length === 1, onclick: () => { q.answers.splice(j, 1); draw(); } }, '✕'))), h('button', { type: 'button', class: 'btn sm', onclick: () => { q.answers.push(''); draw(); } }, '+ Another accepted answer'), err(`questions.${i}.answers`))
          : h('div', {}, h('div', { class: 'small muted' }, q.type === 'single' ? 'Select the one correct option' : 'Tick every correct option'), q.options.map((o, j) => h('div', { class: 'opt' }, h('input', { type: q.type === 'single' ? 'radio' : 'checkbox', name: `c${i}`, class: 'qcorrect', checked: q.correct.includes(j), 'aria-label': `Option ${LETTERS[j]} is correct`, onchange: (e) => { if (q.type === 'single') q.correct = [j]; else q.correct = e.target.checked ? [...new Set([...q.correct, j])] : q.correct.filter((x) => x !== j); } }),
            h('input', { type: 'text', class: 'qopt', value: o, placeholder: `Option ${LETTERS[j]}`, 'aria-label': `Question ${i + 1} option ${LETTERS[j]}`, maxlength: 200, oninput: (e) => { q.options[j] = e.target.value; } }), h('button', { type: 'button', class: 'btn sm', 'aria-label': `Remove option ${LETTERS[j]}`, disabled: q.options.length <= 2, onclick: () => { q.options.splice(j, 1); q.correct = q.correct.filter((x) => x !== j).map((x) => (x > j ? x - 1 : x)); draw(); } }, '✕'))),
            q.options.length < 8 ? h('button', { type: 'button', class: 'btn sm', onclick: () => { q.options.push(''); draw(); } }, '+ Add option') : null, err(`questions.${i}.options`), err(`questions.${i}.correct`)),
        h('label', { class: 'f' }, 'Explanation shown after answering (optional)', h('input', { type: 'text', class: 'qexp', value: q.explanation, maxlength: 500, oninput: (e) => { q.explanation = e.target.value; } })))),
      err('questions'), h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', id: 'add-q', onclick: () => { st.questions.push(blank()); draw(); $$('.qcard').at(-1)?.scrollIntoView({ block: 'center' }); } }, '+ Add question'), h('button', { class: 'btn primary', id: 'save-quiz' }, existing ? 'Save quiz' : 'Create quiz'), h('a', { class: 'btn', href: '#/' }, 'Cancel')));
  };
  const $$ = (s) => [...document.querySelectorAll(s)];
  const form = h('form', { novalidate: true, onsubmit: async (e) => { e.preventDefault(); $('#save-quiz').disabled = true;
    const body = { title: st.title, description: st.description, questions: st.questions.map((q) => (q.type === 'short' ? { type: q.type, prompt: q.prompt, answers: q.answers, explanation: q.explanation } : { type: q.type, prompt: q.prompt, options: q.options, correct: q.correct, explanation: q.explanation })) };
    try { await api(existing ? '/quizzes/' + id : '/quizzes', { method: existing ? 'PUT' : 'POST', body }); toast('Quiz saved'); location.hash = '#/'; }
    catch (x) { errs = x.details || { title: x.message }; draw(); $('.err')?.scrollIntoView({ block: 'center' }); } } }, root);
  render(h('h1', {}, existing ? 'Edit quiz' : 'New quiz'), form); draw();
}

/* ---------- play ---------- */
async function viewPlay(id) {
  const quiz = await api(`/quizzes/${id}/play`), answers = {}; let i = 0;
  const ans = (q) => answers[q.id];
  const done = async () => {
    try { const r = await api(`/quizzes/${id}/attempts`, { method: 'POST', body: { answers } }); showResult(quiz, r); } catch (x) { toast(x.message, 'error'); }
  };
  const draw = () => {
    const q = quiz.questions[i], last = i === quiz.questions.length - 1;
    const body = q.type === 'short' ? h('label', { class: 'f' }, 'Your answer', h('input', { type: 'text', id: 'short', value: ans(q) ?? '', autocomplete: 'off', oninput: (e) => { answers[q.id] = e.target.value; } }))
      : h('div', { role: q.multi ? 'group' : 'radiogroup', 'aria-labelledby': 'qprompt' }, q.options.map((o, k) => h('label', { class: 'choice' }, h('input', { type: q.multi ? 'checkbox' : 'radio', name: 'opt', value: o.id, checked: (ans(q) || []).includes(o.id), onchange: (e) => { const cur = ans(q) || []; answers[q.id] = q.multi ? (e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)) : [o.id]; } }), h('span', {}, `${LETTERS[k]}. ${o.text}`))));
    render(h('div', { class: 'row between' }, h('h1', {}, quiz.title), h('span', { class: 'muted', id: 'pos' }, `Question ${i + 1} of ${quiz.questions.length}`)), h('progress', { max: quiz.questions.length, value: i, 'aria-label': 'Progress' }),
      h('div', { class: 'card' }, h('h2', { id: 'qprompt' }, q.prompt), q.multi ? h('p', { class: 'small muted' }, 'Select all that apply.') : null, body),
      h('div', { class: 'row between' }, h('button', { class: 'btn', id: 'prev', disabled: i === 0, onclick: () => { i--; draw(); } }, '← Back'), last ? h('button', { class: 'btn primary', id: 'finish', onclick: () => { const un = quiz.questions.filter((x) => { const a = answers[x.id]; return a == null || a === '' || (Array.isArray(a) && !a.length); }).length; if (un && !confirm(`${un} question${un === 1 ? ' is' : 's are'} unanswered. Submit anyway?`)) return; done(); } }, 'Finish & grade') : h('button', { class: 'btn primary', id: 'next', onclick: () => { i++; draw(); } }, 'Next →')));
    (q.type === 'short' ? $('#short') : $('.choice input'))?.focus();
  };
  draw();
}
function showResult(quiz, r) {
  const pct = r.percent, label = pct === 100 ? 'Perfect! 🎉' : pct >= 70 ? 'Nice work!' : pct >= 40 ? 'Getting there' : 'Keep practising';
  const fmt = (q) => { const g = q.given; if (q.type === 'short') return g ? `“${g}”` : '—'; return Array.isArray(g) && g.length ? g.map((x) => `${LETTERS[x]}. ${q.options[x]}`).join('; ') : '—'; };
  render(h('h1', {}, quiz.title), h('div', { class: 'card' }, h('div', { class: 'score', id: 'score' }, `${pct}%`), h('p', { id: 'verdict' }, `${label} ${r.correctCount} of ${r.total} fully correct (${r.points} points).`), h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'retake', onclick: () => route() }, 'Retake')   /* same hash as the result page, so re-run the route instead of navigating */, h('a', { class: 'btn', href: '#/' }, 'All quizzes'))),
    h('h2', {}, 'Review'), ...r.review.map((q, n) => h('div', { class: 'rev ' + (q.isCorrect ? 'ok' : q.score > 0 ? 'part' : 'bad'), 'data-review': n }, h('div', {}, h('strong', {}, `${n + 1}. ${q.prompt}`)), h('div', {}, h('span', { class: 'mark ' + (q.isCorrect ? 'ok' : 'bad') }, q.isCorrect ? '✓ Correct' : q.score > 0 ? `◐ Partly correct (${Math.round(q.score * 100)}%)` : '✗ Incorrect'), ' · Your answer: ', fmt(q)),
      q.isCorrect ? null : h('div', {}, 'Correct answer: ', q.type === 'short' ? q.answers.map((a) => `“${a}”`).join(' or ') : q.correct.map((x) => `${LETTERS[x]}. ${q.options[x]}`).join('; ')), q.explanation ? h('div', { class: 'small muted' }, q.explanation) : null)));
}

async function viewHistory(id) {
  const [z, hist] = await Promise.all([api('/quizzes/' + id), api(`/quizzes/${id}/attempts`)]);
  render(h('a', { href: '#/', class: 'small muted' }, '← Quizzes'), h('h1', {}, z.title + ' — history'), hist.length ? h('div', { class: 'card' }, h('ul', { class: 'list', id: 'history' }, hist.map((a) => h('li', { class: 'item' }, h('span', {}, `${a.takenAt} UTC`), h('strong', {}, `${a.percent}%`), h('span', { class: 'muted' }, `${a.points} / ${a.total} points`))))) : h('div', { class: 'card empty' }, 'No attempts yet.'), h('a', { class: 'btn primary', href: `#/play/${id}` }, 'Take quiz'));
}

// Serialize navigations so a slow earlier render can never overwrite a later one.
let routing = Promise.resolve();
function route() { const p = routing.then(doRoute); routing = p.catch(() => {}); return p; }
async function doRoute() {
  const hash = location.hash.slice(1) || '/'; let m;
  render(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (hash === '/') await viewList(); else if (hash === '/new') await viewEditor(null); else if ((m = hash.match(/^\/q\/(\d+)\/edit$/))) await viewEditor(m[1]); else if ((m = hash.match(/^\/q\/(\d+)\/history$/))) await viewHistory(m[1]); else if ((m = hash.match(/^\/play\/(\d+)$/))) await viewPlay(m[1]);
    else render(h('div', { class: 'card empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  } catch (e) {
    if (e.status === 404) render(h('div', { class: 'card empty' }, h('h2', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to quizzes')));
    else render(h('div', { class: 'banner', role: 'alert' }, e.message, ' ', h('button', { class: 'btn', onclick: route }, 'Retry')));
  }
}
addEventListener('hashchange', route); route();
