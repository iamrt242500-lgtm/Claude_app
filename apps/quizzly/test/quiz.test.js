import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnswer, validateQuiz, gradeQuestion, gradeQuiz, shuffle, seeded } from '../src/quiz.js';

const single = { type: 'single', prompt: 'Capital of France?', options: ['Paris', 'Rome', 'Oslo'], correct: [0] };
const multi = { type: 'multi', prompt: 'Primes?', options: ['2', '3', '4', '5'], correct: [0, 1, 3] };
const short = { type: 'short', prompt: 'H2O?', answers: ['Water', 'dihydrogen monoxide'] };

test('normalizeAnswer: case, accents, punctuation, whitespace', () => {
  assert.equal(normalizeAnswer('  Café   AU-lait! '), 'cafe au lait'); assert.equal(normalizeAnswer("It's  the U.S.A."), 'it s the u s a'); assert.equal(normalizeAnswer(null), ''); assert.equal(normalizeAnswer('日本語 テスト'), '日本語 テスト'); assert.equal(normalizeAnswer('ÅNGSTRÖM'), 'angstrom');
});
test('validateQuiz accepts a good quiz and normalizes it', () => {
  const r = validateQuiz({ title: ' Geo ', questions: [{ ...single, prompt: ' Capital of France? ' }, { ...multi, correct: [3, 0, 1, 1] }, { ...short, answers: ['Water', ' water ', '', 'H₂O'] }] });
  assert.equal(r.value.title, 'Geo'); assert.deepEqual(r.value.questions[1].correct, [0, 1, 3]); assert.deepEqual(r.value.questions[2].answers, ['Water', 'H₂O']);
});
test('validateQuiz rejects bad quizzes with path-keyed errors', () => {
  const bad = (q, key, re) => { const r = validateQuiz({ title: 't', questions: [q] }); assert.match(r.errors[key] ?? '', re, JSON.stringify(q)); };
  assert.ok(validateQuiz({ title: '', questions: [] }).errors.title); assert.match(validateQuiz({ title: 't', questions: [] }).errors.questions, /at least one/i); assert.ok(validateQuiz(null).errors.title);
  bad({ type: 'nope', prompt: 'x' }, 'questions.0.type', /Choose/); bad({ ...single, prompt: '' }, 'questions.0.prompt', /required/); bad({ ...single, options: ['only one'], correct: [0] }, 'questions.0.options', /2–8/);
  bad({ ...single, options: ['a', ''], correct: [0] }, 'questions.0.options', /empty/); bad({ ...single, options: ['A', ' a '], correct: [0] }, 'questions.0.options', /different/); bad({ ...single, correct: [] }, 'questions.0.correct', /Mark/);
  bad({ ...single, correct: [0, 1] }, 'questions.0.correct', /exactly one/); bad({ ...single, correct: [5] }, 'questions.0.correct', /Mark/); bad({ ...multi, correct: [0, 1, 2, 3] }, 'questions.0.correct', /Not every/); bad({ ...short, answers: [' ', '!!'] }, 'questions.0.answers', /at least one/);
  assert.ok(validateQuiz({ title: 't', questions: Array.from({ length: 51 }, () => single) }).errors.questions);
});
test('grade single choice', () => { assert.deepEqual(gradeQuestion(single, [0]), { score: 1, correct: true }); for (const g of [[1], [], [0, 1], undefined, 'Paris', [99], [-1]]) assert.equal(gradeQuestion(single, g).score, 0, JSON.stringify(g)); });
test('grade multi with partial credit: wrong picks cancel right ones, never negative', () => {
  assert.deepEqual(gradeQuestion(multi, [0, 1, 3]), { score: 1, correct: true }); assert.equal(gradeQuestion(multi, [0, 1]).score, 2 / 3); assert.equal(gradeQuestion(multi, [0, 1]).correct, false);
  assert.equal(gradeQuestion(multi, [0, 1, 3, 2]).score, 2 / 3, 'one wrong pick costs one right pick'); assert.equal(gradeQuestion(multi, [2]).score, 0); assert.equal(gradeQuestion(multi, [2, 0]).score, 0); assert.equal(gradeQuestion(multi, [0, 0, 1, 3]).correct, true, 'duplicates ignored');
});
test('grade short answers by normalized match', () => {
  for (const g of ['water', ' WATER. ', 'Dihydrogen   Monoxide']) assert.equal(gradeQuestion(short, g).correct, true, g); for (const g of ['', '  ', 'wat', null, 'water water']) assert.equal(gradeQuestion(short, g).correct, false, String(g));
});
test('gradeQuiz totals and percent', () => {
  const qs = [{ id: 1, ...single }, { id: 2, ...multi }, { id: 3, ...short }, { id: 4, ...single }];
  const g = gradeQuiz(qs, { 1: [0], 2: [0, 1], 3: 'Water' }); assert.equal(g.points, 2.67); assert.equal(g.total, 4); assert.equal(g.percent, 67); assert.equal(g.correctCount, 2); assert.deepEqual(g.results.map((r) => r.correct), [true, false, true, false]);
  assert.equal(gradeQuiz(qs, undefined).percent, 0); assert.equal(gradeQuiz([], {}).percent, 0);
});
test('shuffle: permutation, deterministic with seed, does not mutate, fair-ish', () => {
  const a = [1, 2, 3, 4, 5, 6]; const s1 = shuffle(a, seeded(42)), s2 = shuffle(a, seeded(42)); assert.deepEqual(s1, s2); assert.deepEqual([...s1].sort(), a); assert.deepEqual(a, [1, 2, 3, 4, 5, 6]); assert.notDeepEqual(shuffle(a, seeded(1)), shuffle(a, seeded(2)));
  const first = new Map(); const rnd = seeded(7); for (let i = 0; i < 6000; i++) { const f = shuffle(a, rnd)[0]; first.set(f, (first.get(f) || 0) + 1); } for (const n of first.values()) assert.ok(n > 850 && n < 1150, 'each element leads ~1/6 of the time: ' + n);
});
