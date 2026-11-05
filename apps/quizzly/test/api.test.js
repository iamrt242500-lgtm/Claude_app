import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { seeded } from '../src/quiz.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ random: seeded(1) }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const quiz = { title: 'Geo', description: 'Basics', questions: [
  { type: 'single', prompt: 'Capital of France?', options: ['Paris', 'Rome', 'Oslo'], correct: [0], explanation: 'Paris.' },
  { type: 'multi', prompt: 'Primes?', options: ['2', '3', '4', '5'], correct: [0, 1, 3] },
  { type: 'short', prompt: 'Largest ocean?', answers: ['Pacific', 'Pacific Ocean'] }] };

test('create, list, read (author view has answers), update replaces questions, validation errors keyed by path', async () => {
  const bad = await call('POST', '/quizzes', { title: '', questions: [{ type: 'single', prompt: 'x', options: ['a'], correct: [] }] }); assert.equal(bad.status, 422); const d = (await bad.json()).details; assert.ok(d.title && d['questions.0.options']);
  const r = await call('POST', '/quizzes', quiz); assert.equal(r.status, 201); const z = await r.json(); assert.deepEqual(z.questions[0].correct, [0]); assert.equal(z.questions.length, 3);
  const list = await (await call('GET', '/quizzes')).json(); assert.equal(list[0].questions, 3); assert.equal(list[0].attempts, 0); assert.equal(list[0].best, null);
  const upd = await (await call('PUT', `/quizzes/${z.id}`, { ...quiz, title: 'Geo 2', questions: quiz.questions.slice(0, 2) })).json(); assert.equal(upd.title, 'Geo 2'); assert.equal(upd.questions.length, 2);
  assert.equal((await call('DELETE', `/quizzes/${z.id}`)).status, 204); assert.equal((await call('GET', `/quizzes/${z.id}`)).status, 404);
});
test('play payload NEVER contains the answer key; options are shuffled but keep original ids', async () => {
  const z = await (await call('POST', '/quizzes', quiz)).json();
  const raw = await (await call('GET', `/quizzes/${z.id}/play`)).text(); assert.ok(!/"correct"|"answers"|"explanation"/.test(raw), 'no answer key in play payload'); assert.ok(!raw.includes('Pacific Ocean'), 'accepted short answers are not leaked');
  const play = JSON.parse(raw); assert.equal(play.questions.length, 3); const sq = play.questions.find((x) => x.prompt.startsWith('Capital')); assert.deepEqual(sq.options.map((o) => o.id).sort(), [0, 1, 2]); assert.equal(sq.options.find((o) => o.id === 0).text, 'Paris');
  assert.equal(play.questions.find((x) => x.type === 'multi').multi, true);
});
test('grading happens on the server: right, wrong, partial, short; review reveals the key only after submitting', async () => {
  const z = await (await call('POST', '/quizzes', quiz)).json(); const [q1, q2, q3] = z.questions;
  const perfect = await (await call('POST', `/quizzes/${z.id}/attempts`, { answers: { [q1.id]: [0], [q2.id]: [3, 0, 1], [q3.id]: '  pacific OCEAN. ' } })).json(); assert.equal(perfect.percent, 100); assert.equal(perfect.correctCount, 3); assert.ok(perfect.review.every((r) => r.isCorrect));
  const mixed = await (await call('POST', `/quizzes/${z.id}/attempts`, { answers: { [q1.id]: [1], [q2.id]: [0, 1], [q3.id]: 'Atlantic' } })).json(); assert.equal(mixed.points, 0.67); assert.equal(mixed.percent, 22); assert.equal(mixed.review[0].isCorrect, false); assert.deepEqual(mixed.review[0].correct, [0]); assert.equal(mixed.review[1].score, 2 / 3);
  const empty = await (await call('POST', `/quizzes/${z.id}/attempts`, { answers: {} })).json(); assert.equal(empty.percent, 0); assert.equal(empty.review[0].given, null);
  const garbage = await (await call('POST', `/quizzes/${z.id}/attempts`, { answers: { [q1.id]: 'Paris', [q2.id]: [99, -1, 'x'], 999: [0] } })).json(); assert.equal(garbage.percent, 0);
  const hist = await (await call('GET', `/quizzes/${z.id}/attempts`)).json(); assert.equal(hist.length, 4); assert.equal(hist[0].percent, 0); const list = await (await call('GET', '/quizzes')).json(); const row = list.find((x) => x.id === z.id); assert.equal(row.best, 100); assert.equal(row.last, 0); assert.equal(row.attempts, 4);
  assert.equal((await call('POST', `/quizzes/${z.id}/attempts`, { answers: [1] })).status, 422); assert.equal((await call('POST', `/quizzes/${z.id}/attempts`, {})).status, 422);
});
test('editing a quiz does not break history; deleting cascades', async () => {
  const z = await (await call('POST', '/quizzes', quiz)).json(); await call('POST', `/quizzes/${z.id}/attempts`, { answers: {} }); await call('PUT', `/quizzes/${z.id}`, quiz);
  assert.equal((await (await call('GET', `/quizzes/${z.id}/attempts`)).json()).length, 1); await call('DELETE', `/quizzes/${z.id}`); assert.equal((await call('GET', `/quizzes/${z.id}/attempts`)).status, 404);
});
test('errors and static', async () => {
  assert.equal((await call('GET', '/quizzes/abc')).status, 400); assert.equal((await call('GET', '/quizzes/9999/play')).status, 404); assert.equal((await fetch(base + '/api/quizzes', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
