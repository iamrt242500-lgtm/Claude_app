// Pure quiz logic: validation, answer normalization, grading, shuffling.
export const LIMITS = { title: 100, description: 500, prompt: 500, option: 200, explanation: 500, questions: 50, options: [2, 8], answers: 10 };
export const TYPES = ['single', 'multi', 'short'];

/** Case/accent/punctuation/whitespace-insensitive form used to compare short answers. */
export const normalizeAnswer = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Validate an authored quiz. Returns {value} or {errors} (errors keyed by path, e.g. "questions.2.options"). */
export function validateQuiz(b) {
  const errors = {}; b = b && typeof b === 'object' ? b : {};
  const title = typeof b.title === 'string' ? b.title.trim() : '', description = typeof b.description === 'string' ? b.description.trim() : '';
  if (!title) errors.title = 'Title is required'; else if (title.length > LIMITS.title) errors.title = `Title must be ≤ ${LIMITS.title} characters`;
  if (description.length > LIMITS.description) errors.description = `Description must be ≤ ${LIMITS.description} characters`;
  const questions = [];
  if (!Array.isArray(b.questions) || !b.questions.length) errors.questions = 'Add at least one question';
  else if (b.questions.length > LIMITS.questions) errors.questions = `At most ${LIMITS.questions} questions`;
  else b.questions.forEach((q, i) => {
    const k = (f) => `questions.${i}.${f}`; q = q && typeof q === 'object' ? q : {};
    const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '', explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';
    if (!TYPES.includes(q.type)) { errors[k('type')] = 'Choose a question type'; return; }
    if (!prompt) errors[k('prompt')] = 'Question text is required'; else if (prompt.length > LIMITS.prompt) errors[k('prompt')] = `Question must be ≤ ${LIMITS.prompt} characters`;
    if (explanation.length > LIMITS.explanation) errors[k('explanation')] = `Explanation must be ≤ ${LIMITS.explanation} characters`;
    if (q.type === 'short') {
      const seen = new Set(), answers = []; for (const a of Array.isArray(q.answers) ? q.answers : []) { const n = normalizeAnswer(a); if (n && !seen.has(n)) { seen.add(n); answers.push(String(a).trim()); } }   // keep the first spelling of each distinct answer
      if (!answers.length) errors[k('answers')] = 'Add at least one accepted answer'; else if (answers.length > LIMITS.answers) errors[k('answers')] = `At most ${LIMITS.answers} accepted answers`;
      if (!errors[k('prompt')] && !errors[k('answers')]) questions.push({ type: 'short', prompt, answers, explanation });
      return;
    }
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => (typeof o === 'string' ? o.trim() : ''));
    if (options.length < LIMITS.options[0] || options.length > LIMITS.options[1]) errors[k('options')] = `Provide ${LIMITS.options[0]}–${LIMITS.options[1]} options`;
    else if (options.some((o) => !o)) errors[k('options')] = 'Options cannot be empty';
    else if (options.some((o) => o.length > LIMITS.option)) errors[k('options')] = `Options must be ≤ ${LIMITS.option} characters`;
    else if (new Set(options.map(normalizeAnswer)).size !== options.length) errors[k('options')] = 'Options must be different from each other';
    const correct = [...new Set(Array.isArray(q.correct) ? q.correct : [])];
    if (!errors[k('options')]) {
      if (!correct.length || correct.some((c) => !Number.isInteger(c) || c < 0 || c >= options.length)) errors[k('correct')] = 'Mark the correct answer';
      else if (q.type === 'single' && correct.length !== 1) errors[k('correct')] = 'A single-choice question has exactly one correct answer';
      else if (q.type === 'multi' && correct.length === options.length) errors[k('correct')] = 'Not every option can be correct';
    }
    if (!errors[k('prompt')] && !errors[k('options')] && !errors[k('correct')]) questions.push({ type: q.type, prompt, options, correct: correct.sort((a, b) => a - b), explanation });
  });
  if (Object.keys(errors).length) return { errors };
  return { value: { title, description, questions } };
}

/** Score one question. `q` has the answer key; `given`: array of option ids (choice) or a string (short). Returns {score 0..1, correct: bool}. */
export function gradeQuestion(q, given) {
  if (q.type === 'short') { const g = normalizeAnswer(given); const ok = !!g && q.answers.some((a) => normalizeAnswer(a) === g); return { score: ok ? 1 : 0, correct: ok }; }
  const picked = [...new Set(Array.isArray(given) ? given.filter((x) => Number.isInteger(x) && x >= 0 && x < q.options.length) : [])];
  if (q.type === 'single') { const ok = picked.length === 1 && picked[0] === q.correct[0]; return { score: ok ? 1 : 0, correct: ok }; }
  const hits = picked.filter((x) => q.correct.includes(x)).length, misses = picked.length - hits;   // multi: partial credit, wrong picks cancel right ones
  const score = Math.max(0, (hits - misses) / q.correct.length); return { score, correct: hits === q.correct.length && misses === 0 };
}
export function gradeQuiz(questions, answers) {
  const results = questions.map((q) => ({ id: q.id, ...gradeQuestion(q, answers?.[q.id]) }));
  const points = results.reduce((s, r) => s + r.score, 0);
  return { results, points: Math.round(points * 100) / 100, total: questions.length, percent: questions.length ? Math.round((points / questions.length) * 100) : 0, correctCount: results.filter((r) => r.correct).length };
}
/** Fisher–Yates with an injectable RNG (0 <= rnd() < 1). Returns a new array. */
export function shuffle(arr, rnd = Math.random) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/** Small deterministic PRNG (mulberry32) for tests. */
export function seeded(seed) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
