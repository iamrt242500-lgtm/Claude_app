import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { validateQuiz, gradeQuiz, shuffle } from './quiz.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE quizzes(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE questions(id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, position INTEGER NOT NULL, type TEXT NOT NULL CHECK(type IN ('single','multi','short')),
      prompt TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]', correct TEXT NOT NULL DEFAULT '[]', answers TEXT NOT NULL DEFAULT '[]', explanation TEXT NOT NULL DEFAULT '');
    CREATE INDEX idx_questions_quiz ON questions(quiz_id, position);
    CREATE TABLE attempts(id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, taken_at TEXT NOT NULL DEFAULT(datetime('now')), points REAL NOT NULL, total INTEGER NOT NULL, percent INTEGER NOT NULL, answers TEXT NOT NULL);
    CREATE INDEX idx_attempts_quiz ON attempts(quiz_id, id);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 400_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:', random = Math.random } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const quiz404 = (id) => { const z = q('SELECT * FROM quizzes WHERE id=?').get(id); if (!z) throw new HttpError(404, 'Quiz not found'); return z; };
  const questionsOf = (id) => q('SELECT * FROM questions WHERE quiz_id=? ORDER BY position').all(id).map((r) => ({ id: r.id, type: r.type, prompt: r.prompt, options: JSON.parse(r.options), correct: JSON.parse(r.correct), answers: JSON.parse(r.answers), explanation: r.explanation }));
  const saveQuestions = (id, qs) => { q('DELETE FROM questions WHERE quiz_id=?').run(id); qs.forEach((x, i) => q('INSERT INTO questions(quiz_id,position,type,prompt,options,correct,answers,explanation) VALUES(?,?,?,?,?,?,?,?)').run(id, i, x.type, x.prompt, JSON.stringify(x.options ?? []), JSON.stringify(x.correct ?? []), JSON.stringify(x.answers ?? []), x.explanation)); };
  const author = (id) => { const z = quiz404(id); return { id: z.id, title: z.title, description: z.description, questions: questionsOf(id).map(({ id: qid, ...rest }) => ({ id: qid, ...rest })) }; };
  const parsed = (b) => { const r = validateQuiz(b); if (r.errors) throw new HttpError(422, 'Validation failed', r.errors); return r.value; };

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] !== 'quizzes') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') return { body: q(`SELECT z.id, z.title, z.description, (SELECT COUNT(*) FROM questions WHERE quiz_id=z.id) questions, (SELECT COUNT(*) FROM attempts WHERE quiz_id=z.id) attempts,
        (SELECT MAX(percent) FROM attempts WHERE quiz_id=z.id) best, (SELECT percent FROM attempts WHERE quiz_id=z.id ORDER BY id DESC LIMIT 1) last FROM quizzes z ORDER BY z.id DESC`).all() };
      if (m === 'POST') { const v = parsed(await readBody(req)); const id = tx(() => { const id = Number(q('INSERT INTO quizzes(title,description) VALUES(?,?)').run(v.title, v.description).lastInsertRowid); saveQuestions(id, v.questions); return id; }); return { status: 201, body: author(id) }; }
      throw new HttpError(405, 'Method not allowed');
    }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); quiz404(id);
    if (p.length === 2) {
      if (m === 'GET') return { body: author(id) };
      if (m === 'PUT') { const v = parsed(await readBody(req)); tx(() => { q("UPDATE quizzes SET title=?, description=?, updated_at=datetime('now') WHERE id=?").run(v.title, v.description, id); saveQuestions(id, v.questions); }); return { body: author(id) }; }
      if (m === 'DELETE') { q('DELETE FROM quizzes WHERE id=?').run(id); return { status: 204 }; }
    }
    if (p[2] === 'play' && m === 'GET') {
      // The answer key never leaves the server: options carry their ORIGINAL index as an id, so shuffled order can be graded.
      const z = quiz404(id), qs = shuffle(questionsOf(id), random).map((x) => ({ id: x.id, type: x.type, prompt: x.prompt, ...(x.type === 'short' ? {} : { multi: x.type === 'multi', options: shuffle(x.options.map((text, oid) => ({ id: oid, text })), random) }) }));
      return { body: { id: z.id, title: z.title, description: z.description, questions: qs } };
    }
    if (p[2] === 'attempts') {
      if (m === 'GET') return { body: q('SELECT id, taken_at takenAt, points, total, percent FROM attempts WHERE quiz_id=? ORDER BY id DESC LIMIT 50').all(id) };
      if (m === 'POST') {
        const b = await readBody(req); if (!b.answers || typeof b.answers !== 'object' || Array.isArray(b.answers)) throw new HttpError(422, 'Validation failed', { answers: 'answers must be an object keyed by question id' });
        const qs = questionsOf(id), g = gradeQuiz(qs, b.answers), r = q('INSERT INTO attempts(quiz_id,points,total,percent,answers) VALUES(?,?,?,?,?)').run(id, g.points, g.total, g.percent, JSON.stringify(b.answers));
        const byId = new Map(g.results.map((x) => [x.id, x]));
        return { status: 201, body: { attemptId: Number(r.lastInsertRowid), points: g.points, total: g.total, percent: g.percent, correctCount: g.correctCount,
          review: qs.map((x) => ({ id: x.id, type: x.type, prompt: x.prompt, options: x.options, correct: x.correct, answers: x.answers, explanation: x.explanation, given: b.answers[x.id] ?? null, score: byId.get(x.id).score, isCorrect: byId.get(x.id).correct })) } };
      }
    }
    throw new HttpError(405, 'Method not allowed');
  }

  const server = createServer(async (req, res) => {
    const send = (s, b, t = 'application/json; charset=utf-8') => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store' }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body)); }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel.includes('..')) throw new HttpError(404, 'Not found');
      try { return send(200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] || 'application/octet-stream'); } catch { throw new HttpError(404, 'Not found'); }
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, JSON.stringify({ error: e.message, details: e.details }));
      if (e instanceof URIError) return send(400, JSON.stringify({ error: 'Bad request' }));
      console.error(e); send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/quizzly.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Quizzly listening on :${port}`));
}
